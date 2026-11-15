'use strict';
// Offline configuration inspection. No network, database connection, mail sending, or file mutation.
const path = require('node:path');
const fs = require('node:fs');

function inspect(env, validate) {
  const problems = [];
  if (env.NODE_ENV !== 'production') problems.push('NODE_ENV must be production for the release check.');
  let normalized;
  try { normalized = validate({ ...env }); }
  catch (error) {
    // The validator emits fixed variable names, never configuration values.
    problems.push(error instanceof Error ? error.message : 'CONFIGURATION_INVALID');
  }
  if (normalized && normalized.MAIL_TRANSPORT !== 'resend') problems.push('MAIL_TRANSPORT must be resend for this release.');
  const paused = normalized?.MAIL_SENDING_ENABLED === 'false';
  if (paused) problems.push('MAIL_SENDING_ENABLED=false: sending and new email verification requests are paused.');
  return { configurationValid: Boolean(normalized), readyForMailTest: problems.length === 0,
    externalServicesVerified: false, mailPaused: paused, problems };
}
function main() {
  const target = path.resolve(__dirname, '../dist/src/config/env.validation.js');
  if (!fs.existsSync(target)) { console.error(JSON.stringify({ code: 'BUILD_REQUIRED' })); process.exitCode = 1; return; }
  const { validateEnvironment } = require(target);
  const result = inspect(process.env, validateEnvironment);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.readyForMailTest ? 0 : result.configurationValid ? 2 : 1;
}
module.exports = { inspect };
if (require.main === module) main();
