// Some code adapted from Bitcoin lib v1.2 (c) 2014 by Icedude

var CryptoJS = require("crypto-js");
var constants = require('./constants');
var base64 = require('./base64Tools');

var asc256 = []; //ascii char value is converted to 58base value
var alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
for (var i = 0, len = 256; i < len; i++) {
  var alphaIndex = alphabet.indexOf(String.fromCharCode(i));
  asc256.push(alphaIndex > -1 ? alphaIndex : -1);
}

var checksum = 0;
var wordarray = CryptoJS.lib.WordArray.create(new Array(7), 21); //holds 21 bytes of the addresses 25total bytes. so need 28byte array


exports.testAddress = function (address) {
  if (address.length < 26 || (address.charCodeAt(0) !== 49 && address.charCodeAt(0) !== 51 && address.charCodeAt(0) !== 87)) return 0; //has to start with "1"/49 "3"/51 means bitcoin address
  if (!this.unbase58(address)) return 0;
  var hashWordArray = CryptoJS.SHA256(CryptoJS.SHA256(wordarray));
  if (hashWordArray['words'][0] === checksum) {
    var string = CryptoJS.enc.Latin1.stringify(wordarray);
    var i, len, paddingString = 0,
      paddingAddress = 0;
    for (i = 1, len = string.length; i < len; i++) {
      if (string.charCodeAt(i) !== 0) break;
      paddingString += 1;
    }
    for (i = 1, len = address.length; i < len; i++) {
      if (address.charCodeAt(i) !== 49) break;
      paddingAddress += 1;
    }
    if (paddingAddress === paddingString) return 1;
  }
  return 0;
}

exports.getAddressPayload = function (address) {
  if (!this.unbase58(address)) return null;
  var string = CryptoJS.enc.Latin1.stringify(wordarray);
  //still contains leading and trailing 00 bytes
  return string.substr(1);
}

exports.purifyPayload = function (payload) {
  var cleaned = '';
  for (var i = 0; i < payload.length; i++) {
    var charCode = payload.charCodeAt(i);
    var allowedLetter = false;
    for (var j = 0; j < constants.TWIST_ID_ALLOWED_CHARS.length; j++) {
      var allowedCharCode = constants.TWIST_ID_ALLOWED_CHARS.charCodeAt(j);
      if (allowedCharCode == charCode) {
        allowedLetter = true;
        break;
      }
    }
    if (allowedLetter) {
      cleaned += payload[i];
    } else {
      break;
    }
  }
  return cleaned;
}

exports.extractPayloadsFromTwistIdRegBurnAddresses = function (burnAddresses) {
  // id is always the first address
  var id = this.purifyPayload(this.getAddressPayload(burnAddresses[0]));
  var pubKey = "";
  var privKey = "";
  for (var i = 1; i < 5; i++) {
    pubKey += this.getAddressPayload(burnAddresses[i]);
  }
  for (var i = 5; i < burnAddresses.length; i++) {
    privKey += this.getAddressPayload(burnAddresses[i]);
  }

  var pubKeyFinal = base64.stripNonBase64Chars(pubKey);
  var privKeyFinal = base64.stripNonBase64Chars(privKey);

  return {
    'id': id,
    'pubKey': pubKeyFinal,
    'privKey': privKeyFinal
  };
}

exports.extractPayloadsFromTwistIdTxAddresses = function (addresses) {
  // sender id is always the first address
  var senderId = this.purifyPayload(this.getAddressPayload(addresses[0]));
  // rest of the addresses contain an encrypted message
  var message = "";
  for (var i = 1; i < addresses.length; i++) {
    message += this.getAddressPayload(addresses[i]);
  }
  var messageFinal = base64.decode(base64.stripNonBase64Chars(message));

  return {
    'senderId': senderId,
    'message': messageFinal
  };
}

exports.createAddressFromText = function (payload) {
  return this.base58(payload);
}

exports.genAddressesFromText = function (text_in, endWithNewLine) {
  var text = text_in;
  var endWithNL = endWithNewLine;
  if (endWithNL && text.length > 20 && text.search("\n") === -1)
    text += "\n";
  var nrOfAddressesNeeded = (((text.length - 1) / 20) + 1) >>> 0;
  var addressesAsTextInArray = [];
  for (var i = 0, len = nrOfAddressesNeeded; i < len; i++) {
    addressesAsTextInArray.push(this.createAddressFromText(text.substr(i * 20, 20)));
  }
  return addressesAsTextInArray;
}

exports.unbase58 = function (base58str) {
  var intAr = wordarray['words'],
    base = 58,
    c;

  this.resetArrayTo(intAr, 0);

  for (i = 0, len = base58str.length; i < len; i++) {
    if ((c = asc256[base58str.charCodeAt(i)]) < 0) return 0; //bad char
    for (var j = intAr.length; j--;) {
      c += base * intAr[j];
      intAr[j] = c % 0x100000000; //c mod #FFFFFFFF
      c = c / 0x100000000 >>> 0; //c div #FFFFFFFF
    }
    if (c) return 0; //"address too long";
  }
  checksum = intAr[intAr.length - 1] >> 0; //make checksum to integer
  intAr[intAr.length - 1] = 0;
  c = 0;
  var flow = 0;
  for (i = intAr.length; i--;) { //shift all integers left for wordarray
    c = intAr[i];
    intAr[i] = (c << 24) + flow;
    flow = c >>> 8;
  }
  return 1;
}

exports.base58 = function (text) {
  var intAr = wordarray['words'],
    base = 58,
    i, len;
  this.resetArrayTo(intAr, 0);

  var padding = '';
  for (i = 0, len = text.length; i < len; i++) {
    if (text.charCodeAt(i) !== 0) break;
    padding += '1';
  }

  if (padding.length === text.length) padding = "11111111111111111111";

  text = String.fromCharCode(0) + text; //add 00 before message
  //console.log("text: " + text);

  for (i = 0, len = Math.min(text.length, 21); i < len; i++) { //put ascii chars to int array
    intAr[i / 4 >> 0] |= text.charCodeAt(i) << 24 - i % 4 * 8;
  }

  //console.log("word array: " + wordarray);
  //console.log("int array: " + intAr);
  var hashWordArray = CryptoJS.SHA256(CryptoJS.SHA256(wordarray));
  var checksum = hashWordArray['words'][0];
  //console.log("hashword array: " + hashWordArray);
  //console.log("checksum: " + checksum);

  //shift all integers right for wordarray
  //can potentially be optimized to the last for loop
  var c = 0;
  var flow = 0;
  for (i = 0, len = intAr.length; i < len; i++) {
    c = intAr[i];
    intAr[i] = (c >>> 24) + flow;
    flow = c << 8;
  }

  //console.log("int array (shifted): " + intAr);
  //        intAr[0] = parseInt("00000001", 16);

  //place checksum
  intAr[intAr.length - 1] = checksum;
  //console.log("int array (checksum): " + intAr);

  var base58encoded = "";
  var reminder, valueExists;
  while (true) {
    valueExists = 0;
    reminder = 0;
    for (i = 0, len = intAr.length; i < len; i++) {
      reminder = 0x100000000 * reminder + (intAr[i] >>> 0);
      if (intAr[i] !== 0) valueExists = 1;
      intAr[i] = reminder / base >>> 0;
      reminder = reminder % base;
    }
    if (!valueExists) break;
    base58encoded = alphabet[reminder] + base58encoded; // the reason why 1 is added all the time to all addresses is because reminder=0 and 0='1' so this line of code should execute only when valueExists !== 0
  }

  return '1' + padding + base58encoded;
}

exports.resetArrayTo = function (array, val) {
  var i = array.length;
  while (i--) array[i] = val;
}