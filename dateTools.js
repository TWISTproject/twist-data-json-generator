var moment = require('moment');

exports.dayFromUnixTime = function (unixTime) {
    return moment.unix(unixTime).format("D");
}

exports.monthFromUnixTime = function (unixTime) {
    return moment.unix(unixTime).format("MMM");
}

exports.dateFromUnixTime = function (unixTime) {
    return moment.unix(unixTime).format("ddd, MMM Do YYYY, h:mm:ss a");
}