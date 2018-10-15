exports.toFixed = function (num, fixed) {
  var re = new RegExp('^-?\\d+(?:\.\\d{0,' + (fixed || -1) + '})?');
  return num.toString().match(re)[0];
}

exports.isInt = function (value) {
  return !isNaN(value) && (function (x) {
    return (x | 0) === x;
  })(parseFloat(value))
}

exports.escapeHtml = function (text) {
  var map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return text.replace(/[&<>"']/g, function (m) {
    return map[m];
  });
}

/**
 * Returns a random integer between min (inclusive) and max (inclusive)
 * Using Math.round() will give you a non-uniform distribution!
 */
exports.getRandomInt = function (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

exports.getTwistDataDirectoryPath = function () {
  var isWin = /^win/.test(process.platform);
  var isLinux = /^linux/.test(process.platform);
  var isMac = /^darwin/.test(process.platform);

  // determine twist data directory based on OS
  var twistDir = "";
  if (isWin) {
    twistDir = process.env.APPDATA + '\\TWIST';
  } else if (isLinux) {
    twistDir = process.env.HOME + '/.twist';
  } else {
    twistDir = process.env.HOME + 'TWIST'; // needs to be Library/Application Support/TWIST
  }

  return twistDir;
}

exports.getTwistIdFilePath = function () {
  var constants = require('./constants');
  return this.getTwistDataDirectoryPath() + '\\' + constants.FILE_NAME_TWIST_ID;
}

exports.getTwistDataFilePath = function () {
  var constants = require('./constants');
  return this.getTwistDataDirectoryPath() + '\\' + constants.FILE_NAME_TWIST_DATA;
}