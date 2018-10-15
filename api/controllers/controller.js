'use strict';
var jsonfile = require('jsonfile');
var utils = require('../../utils');
exports.list_all_twist_id_info = function (req, res) {
    // retrieve existing data from persistent storage
    var filePath = utils.getTwistIdFilePath();
    jsonfile.readFile(filePath, function (err, obj) {
        if (err) {
            res.json({});
        } else {
            res.json(obj);
        }
    });
};

exports.list_all_twist_data_info = function (req, res) {
    // retrieve existing data from persistent storage
    var filePath = utils.getTwistDataFilePath();
    jsonfile.readFile(filePath, function (err, obj) {
        if (err) {
            res.json({});
        } else {
            res.json(obj);
        }
    });
};