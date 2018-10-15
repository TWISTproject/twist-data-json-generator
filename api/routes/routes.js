'use strict';
module.exports = function (app) {
    var toolbox = require('../controllers/controller');

    // toolbox routes
    app.route('/twist_id').get(toolbox.list_all_twist_id_info);
    app.route('/twist_data').get(toolbox.list_all_twist_data_info);
};