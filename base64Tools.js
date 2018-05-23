var Base64 = require('js-base64').Base64;
var base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

exports.stripNonBase64Chars = function (str) {
    var cleaned = "";
    for (var i = 0; i < str.length; i++) {
        var charCode = str.charCodeAt(i);
        var allowedLetter = false;
        for (var j = 0; j < base64Alphabet.length; j++) {
            var allowedCharCode = base64Alphabet.charCodeAt(j);
            if (allowedCharCode == charCode) {
                allowedLetter = true;
                break;
            }
        }
        if (allowedLetter) {
            cleaned += str[i];
        }
    }
    return cleaned;
}

exports.encode = function (str) {
    return Base64.encode(str);
}

exports.decode = function (str) {
    return Base64.decode(str);
}

exports.base64ToUTF8 = function (str) {
    return Base64.decode(str);
}