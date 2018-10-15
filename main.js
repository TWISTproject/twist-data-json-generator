const fs = require('fs');
const url = require('url');
const path = require('path');
const Client = require('bitcoin-core');
const os = require('os');
const jsonfile = require('jsonfile');
const crypto = require('crypto');
const base58 = require('./base58Tools');
const constants = require('./constants');
const utils = require('./utils');

// SET ENV
process.env.NODE_ENV = 'production';

var client;

var startup = {
    twistDir: '',
    confOk: false,
    connectOk: false,
    message: ''
}

var confCredentials = {
    rpcuser: '',
    rpcpassword: '',
    rpcport: constants.DEFAULT_RPC_PORT,
    rpcallowip: '',
    server: '0'
}

var info = {
    unspentInputs: [],
    unspentAddresses: [],
    walletAddresses: [],
    walletBalance: 0.00,
}

var monitorBlocks = true;
var lastSeenBlock = 0;

// for async waiting
const snooze = ms => new Promise(resolve => setTimeout(resolve, ms));

async function init() {
    // locate the TWIST-qt directory
    await getTwistDirectory();
    // parse (or create and parse) a config file
    handleTwistConf();
}

init();

async function setupRpcClient() {
    console.log('establishing rpc connection with credentials', confCredentials);
     client = new Client({
        'username': confCredentials.rpcuser,
        'password': confCredentials.rpcpassword,
        'port': confCredentials.rpcport
    });

    var connected = false;
    while (!connected) {
        client.getInfo((error, help) => {
            if (error) {
                startup.connectOk = false;
                startup.message = "Error: Can't connect to TWIST wallet. Try restarting your wallet."
            } else {
                startup.connectOk = true;
                connected = true;
            }
            // notify renderer of completion
            console.log('startup-completed-connect', startup);
        });
        // wait for 3 seconds
        await snooze(3 * 1000);
    }
    // connected so check for new blocks
    monitorNewBlocks();
}

function handleTwistConf() {
    var twistConfPath = startup.twistDir + '\\twist.conf';

    // twist.conf doesn't exist
    if (!fs.existsSync(twistConfPath)) {
        console.log('creating conf file');
        // write empty conf file
        fs.writeFile(twistConfPath, "", 'utf8', (err) => {
            if (err) {
                throw err;
            } else {
                parseConfFile(twistConfPath);
            }
        });
    } else {
        parseConfFile(twistConfPath);
    }

}

async function getTwistDirectory() {
    var twistDir = utils.getTwistDataDirectoryPath();

    // create directory if doesn't exist
    fs.access(twistDir, function (err) {
        if (err && err.code === 'ENOENT') {
            fs.mkdir(twistDir);
        }
    });

    // set twist dir globally
    startup.twistDir = twistDir;
    // notify renderer of completion
    console.log('startup-completed-directory', startup);
}

function parseConfFile(path) {
    var mandatoryFields = {
        rpcuser: "user",
        rpcpassword: "pass",
        rpcport: constants.DEFAULT_RPC_PORT,
        rpcallowip: "127.0.0.1",
        server: "1",
    }
    // generate a random username and password
    mandatoryFields.rpcuser += crypto.randomBytes(8).toString('hex');
    mandatoryFields.rpcpassword += crypto.randomBytes(8).toString('hex');

    // read conf file
    var toAdd = "";
    fs.readFile(path, 'utf-8', (err, data) => {
        if (err) {
            throw err;
        } else {
            var lines = data.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
            // for each mandatory field
            for (i in mandatoryFields) {
                var defined = false;
                var definingLine = "";
                // for each line of the config
                for (l in lines) {
                    var line = lines[l];
                    // line is defining a mandatory field
                    if (line.includes(i + "=")) {
                        defined = true;
                        definingLine = line;
                    }
                }

                // field has been defined in the conf, attempt to parse
                if (defined) {
                    var val = '';
                    try {
                        val += definingLine.substring(definingLine.indexOf('=') + 1).trim();
                    } catch (err) {
                        val = '';
                    }
                    confCredentials[i] = val;

                    // special case for server (where we want to overwrite existing setting)
                    if (i == 'server' && val.trim() == '0') {
                        toAdd += '\n' + i + "=" + mandatoryFields[i];
                        confCredentials[i] = mandatoryFields[i];
                    }
                }
                // field not defined, prepare it to be appended
                else {
                    toAdd += '\n' + i + "=" + mandatoryFields[i];
                    confCredentials[i] = mandatoryFields[i];
                }
            }

            if (toAdd.length > 0) {
                fs.appendFile(path, toAdd, function (err) {
                    if (err) {
                        // append failed
                    } else {
                        finishConfCheck();
                    }
                })
            } else {
                finishConfCheck();
            }
        }
    });
}

function finishConfCheck() {
    startup.confOk = false;
    // check if rpc credentials are valid
    if (confCredentials.rpcuser.trim().length > 0 && confCredentials.rpcpassword.trim().length > 0) {
        startup.confOk = true;
    } else {
        startup.confOk = false;
        startup.message = "Error parsing twist.conf file. Try deleting the conf file and restarting the toolbox."
    }

    // notify renderer of completion
    console.log('startup-completed-conf', startup);
    // create the rpc client and connect
    setupRpcClient();
}

async function scanForTwistIdInfo() {
    var debug = constants.DEBUG;
	debug = true;

    // twist id reg
    var twistIdRegistrations = [];
    var validTwistIds = [];
    var registrantSet = new Set();
    var idSet = new Set();
    var pubKeySet = new Set();

    // twist id tx
    var twistIdTxs = [];
    var twistIdTxTxIds = new Set();

    var scannedBlocks = 1;
    var startBlock = constants.TWIST_ID_SCAN_START_BLOCK;
    var endBlock;
    try {
        endBlock = await client.getBlockCount();
    } catch (err) {
        return;
    }

    // update global block index
    if (lastSeenBlock == 0) {
        lastSeenBlock = endBlock;
    }
    
    // read from json
    try {
        if(constants.READ_DATA_FROM_JSON) {
            var filePath = utils.getTwistIdFilePath();
            var dataSource = await jsonfile.readFileSync(filePath);
            console.log("reading json data from " + filePath);
            // retrieve existing data from json file if possible
            if(dataSource != null && Object.keys(dataSource).length != 0) {
                // check last scanned block is valid
                if (!isNaN(dataSource.block) && dataSource.block <= endBlock) {
                    startBlock = dataSource.block;
                    if (debug) console.log('storage retrieved: block');
                }
                // check registrations is in the correct format
                if (Array.isArray(dataSource.registrations)) {
                    twistIdRegistrations = dataSource.registrations;
                    if (debug) console.log('storage retrieved: registrations');
                }
                // check registrants is in the correct format
                if (Array.isArray(dataSource.registrantArray)) {
                    registrantSet = new Set(dataSource.registrantArray);
                    if (debug) console.log('storage retrieved: registrantArray');
                }
                // check ids are in the correct format
                if (Array.isArray(dataSource.idArray)) {
                    idSet = new Set(dataSource.idArray);
                    if (debug) console.log('storage retrieved: idArray');
                }
                // check pubkeys are in the correct format
                if (Array.isArray(dataSource.pubKeyArray)) {
                    pubKeySet = new Set(dataSource.pubKeyArray);
                    if (debug) console.log('storage retrieved: pubKeyArray');
                }
                // check valid twist ids are in the correct format
                if (Array.isArray(dataSource.validTwistIds)) {
                    validTwistIds = dataSource.validTwistIds;
                    if (debug) console.log('storage retrieved: validTwistIds');
                }
                // check twist id tx's are in the correct format
                if (Array.isArray(dataSource.twistIdTxs)) {
                    twistIdTxs = dataSource.twistIdTxs;
                    if (debug) console.log('storage retrieved: twistIdTxs');
                }
                // check twist id txId's are in the correct format
                if (Array.isArray(dataSource.twistIdTxTxIdsArray)) {
                    twistIdTxTxIds = new Set(dataSource.twistIdTxTxIdsArray);
                    if (debug) console.log('storage retrieved: twistIdTxTxIdsArray');
                }
            }
        }
    } catch (err) {
        console.log('cannot read from json file');
        console.log('starting scan from block ' + startBlock);
    }

    scannedBlocks = startBlock;

    // scan transactions in each block
    for (var i = startBlock; i <= endBlock; i++) {
        if (debug) console.log('block: ' + i);
        var blockHash;
        var block;
        try {
            blockHash = await client.getBlockHash(i);
            block = await client.getBlock(blockHash);
        } catch (err) {
            return;
        }
        var blockTime = block.time;
        for (var j = 0; j < block.tx.length; j++) {
            var txId = block.tx[j];
            var res = null;
            var err = null;
            var altTx = null;
            var tx = null;
            altTx = await client.getTransaction(txId).catch((result, error) => {
                res = result.text;
                err = error;
            });
            if (altTx == null && (res == null || err != null)) {
                continue;
            }
            if (altTx != null) {
                tx = altTx;
            } else {
                tx = JSON.parse(res).result;
            }
            if (debug) console.log('tx');
            var vin = tx.vin;
            var vout = tx.vout;

            // only transactions that can be relevant are inspected
            // twist id reg transactions are only ever 17 vouts
            // twist id transactions always have at least 10 vouts
            if (vout != null && vout.length >= 10) {
                if (debug) console.log('vout');

                // twist id reg
                var idRegDetected = false;
                var idRegAddresses = new Set();

                // twist id tx
                var twistIdTxDetected = false;
                var twistIdTxFlagAddr = '';
                var twistIdTxAddrVal = [];

                for (var k = 0; k < vout.length; k++) {
                    if (vout[k]['scriptPubKey']['type'] === 'nonstandard') {
                        break;
                    }
                    var addr = vout[k]['scriptPubKey']['addresses'][0];
                    var val = vout[k]['value'];

                    // twist id reg
                    if (idRegDetected) {
                        idRegAddresses.add(addr);
                    } else {
                        if (addr === constants.TWIST_ID_REG_ADDRESS) {
                            // check they have paid the fee
                            if (val >= (0.98 * constants.TWIST_ID_REG_FEE)) {
                                idRegDetected = true
                                k = -1; // start from the beginning (so we can log addresses)
                            }
                        }
                    }

                    // twist id tx
                    if (twistIdTxDetected) {
                        twistIdTxAddrVal.push({
                            'address': addr,
                            'amount': val
                        });
                    } else {
                        if (addr === constants.TWIST_ID_SEND_TWIST_TX_STANDARD_ADDRESS || addr === constants.TWIST_ID_SEND_TWIST_TX_MESSAGE_ADDRESS) {
                            twistIdTxFlagAddr = addr;
                            var fee = constants.TWIST_ID_SEND_TWIST_TX_STANDARD_FEE;
                            // fee is different if they've sent a message
                            if (twistIdTxFlagAddr === constants.TWIST_ID_SEND_TWIST_TX_MESSAGE_ADDRESS) {
                                fee = constants.TWIST_ID_SEND_TWIST_TX_MESSAGE_FEE;
                            }
                            // check they have paid the fee
                            if (val >= (0.98 * fee)) {
                                twistIdTxDetected = true;
                                k = -1; // start from the beginning (so we can log addresses)
                            }
                        }
                    }
                }

                // twist id reg
                if (idRegDetected) {
                    if (debug) console.log('id reg detected');
                    // now we check inputs to the transaction (all inputs must originate from the same address)
                    var idRegOriginAddresses = new Set();
                    for (var l = 0; l < vin.length; l++) {
                        originTxid = vin[l]['txid'];
                        originVout = vin[l]['vout'];

                        res = null;
                        err = null;
                        altTx = null;
                        tx = null;
                        altTx = await client.getTransaction(originTxid).catch((result, error) => {
                            res = result.text;
                            err = error;
                        });
                        if (altTx == null && (res == null || err != null)) {
                            continue;
                        }
                        if (altTx != null) {
                            tx = altTx;
                        } else {
                            tx = JSON.parse(res).result;
                        }
                        if (debug) console.log('tx (vin)');
                        vout = tx.vout;
                        for (var m = 0; m < vout.length; m++) {
                            if (debug) console.log('vout (vin)');
                            // this is the output used as an input, examine address
                            if (vout[m]['n'] == originVout) {
                                var scriptPubKey = vout[m]['scriptPubKey'];
                                var addresses = scriptPubKey['addresses'];
                                for (var n = 0; n < addresses.length; n++) {
                                    idRegOriginAddresses.add(addresses[n]);
                                }
                            }
                        }
                    }

                    // only one input address
                    if (idRegOriginAddresses.size == 1) {
                        // get origin address
                        var originAddr = idRegOriginAddresses.values().next().value;
                        idRegAddresses.delete(originAddr); // remove change address
                        idRegAddresses.delete(constants.TWIST_ID_REG_ADDRESS); // remove reg address
                        // now we're left with burn addresses
                        var burnAddresses = Array.from(idRegAddresses);
                        var payloads = base58.extractPayloadsFromTwistIdRegBurnAddresses(burnAddresses);
                        var twistIdObj = {
                            'registrant': originAddr,
                            'idAddress': burnAddresses[0],
                            'id': payloads.id,
                            'pubKey': payloads.pubKey,
                            'privKey': payloads.privKey,
                            'block': i,
                            'blockTime': blockTime,
                            'txId': txId
                        };
                        if (debug) console.log(twistIdObj);
                        // add registration (still subject to validation)
                        twistIdRegistrations.push(twistIdObj);

                        // validate registration
                        // this address has already registered an id or the id has already been registered or pubkey already in use
                        if (registrantSet.has(originAddr) ||
                            idSet.has(payloads.id.toLowerCase()) ||
                            pubKeySet.has(payloads.pubKey) ||
                            payloads.pubKey.length != constants.TWIST_KEY_PUBLIC_LENGTH_B64 ||
                            payloads.privKey.length != constants.TWIST_KEY_PRIVATE_LENGTH_B64) {
                            // invalid
                        }
                        // this address has not registered an id and this id has not been registered
                        else {
                            // check id is valid format
                            if (idIsValidFormat(payloads.id.toLowerCase(), false, idSet)) {
                                // valid
                                registrantSet.add(originAddr);
                                idSet.add(payloads.id.toLowerCase());
                                pubKeySet.add(payloads.pubKey);
                                validTwistIds.push(twistIdObj);
                            }
                        }
                    }
                }

                // twist id tx
                if (twistIdTxDetected) {
                    if (debug) console.log('twist id tx detected');

                    if (debug) console.log("twistIdTxAddrVal: ", twistIdTxAddrVal);
                    if (debug) console.log("txAddresses: ", txAddresses);

                    // recipient is always the first address
                    var recipientAddr = twistIdTxAddrVal[0].address;
                    var recipientAmt = twistIdTxAddrVal[0].amount;

                    // list of all addresses
                    var txAddresses = twistIdTxAddrVal.map(a => a.address);
                    // find index of twist id tx address
                    if (txAddresses[1] === twistIdTxFlagAddr) {
                        // remove first two addresses
                        txAddresses.shift();
                        txAddresses.shift();
                    } else if (txAddresses[2] === twistIdTxFlagAddr) {
                        // remove first three addresses (one is a change address)
                        txAddresses.shift();
                        txAddresses.shift();
                        txAddresses.shift();
                    } else {
                        // invalid tx
                        continue;
                    }

                    var includesMsg = false;
                    if (twistIdTxFlagAddr === constants.TWIST_ID_SEND_TWIST_TX_MESSAGE_ADDRESS) {
                        includesMsg = true;
                    }

                    // extract sender id and message from remaining addresses
                    var payloads = base58.extractPayloadsFromTwistIdTxAddresses(txAddresses);
                    var twistIdTxObj = {
                        'senderId': payloads.senderId,
                        'recipientId': '',
                        'recipientAddr': recipientAddr,
                        'amount': recipientAmt,
                        'message': payloads.message,
                        'hasMessage': includesMsg,
                        'block': i,
                        'blockTime': blockTime,
                        'txId': txId
                    };
                    //console.log('twistIdTxObj: ', twistIdTxObj);
                    if (!twistIdTxTxIds.has(twistIdTxObj.txId)) {
                        twistIdTxTxIds.add(twistIdTxObj.txId);
                        twistIdTxs.push(twistIdTxObj);
                    }
                }
            }
        }
        scannedBlocks = i;
        // notify renderer of progress
        // only display 1 in 5000 blocks (for performance reasons)
        var display = false;
        if (scannedBlocks % 5000 === 0) {
            display = true;
        } else if (scannedBlocks == endBlock) {
            display = true;
        }

        if (display) {
            console.log('blocks-processed', {
                'current': scannedBlocks,
                'total': endBlock
            });
        }
    }
    if (debug) console.log('finished indexing twist id registrations and transactions');

    // we have finished collecting valid twist id's
    // look up recipient address to determine recipient id for each twist id tx
    for (var i = 0; i < twistIdTxs.length; i++) {
        // if recipient id is empty
        if (twistIdTxs[i].recipientId.length < 1) {
            // find and set recipient id
            for (var j = 0; j < validTwistIds.length; j++) {
                if (twistIdTxs[i].recipientAddr == validTwistIds[j].registrant) {
                    twistIdTxs[i].recipientId = validTwistIds[j].id;
                    break;
                }
            }
        }
    }

    // save twist id info
    var twistIdInfoObj = {
        'block': scannedBlocks,
        'registrations': twistIdRegistrations,
        'registrantArray': Array.from(registrantSet),
        'idArray': Array.from(idSet),
        'pubKeyArray': Array.from(pubKeySet),
        'validTwistIds': validTwistIds,
        'twistIdTxTxIdsArray': Array.from(twistIdTxTxIds),
        'twistIdTxs': twistIdTxs,
    };
    
    // write to json
    var filePath = utils.getTwistIdFilePath();
    console.log('writing twist id info to json file', filePath);
    await jsonfile.writeFile(filePath, twistIdInfoObj, function (err) {
        if (err) {
            console.error(err);
        }
    });
}

function idIsValidFormat(id, checkUnique, idSet) {
    // id isn't null
    if (id == null) {
        return false;
    }
    // id min length
    if (id.length < constants.TWIST_ID_MIN_LENGTH) {
        return false;
    }
    // id max length
    if (id.length > constants.TWIST_ID_MAX_LENGTH) {
        return false;
    }
    // id allowed characters
    var allowedChars = constants.TWIST_ID_ALLOWED_CHARS;
    for (var i = 0; i < id.length; i++) {
        var charCode = id.charCodeAt(i);
        var allowedLetter = false;
        for (var j = 0; j < allowedChars.length; j++) {
            var allowedCharCode = allowedChars.charCodeAt(j);
            if (allowedCharCode == charCode) {
                allowedLetter = true;
                break;
            }
        }
        if (!allowedLetter) {
            return false;
        }
    }
    // id unique
    if (checkUnique) {
        return !idSet.has(id.toLowerCase());
    }
    // id valid
    return true;
}

async function monitorNewBlocks() {
    while (monitorBlocks) {
        var block;
        try {
            block = await client.getBlockCount();
        } catch (err) {
            return;
        }
        if (block != lastSeenBlock) {
            lastSeenBlock = block;
            // send data to renderer
            console.log("new block found", lastSeenBlock);
            // search for TWIST ID/DATA info
            await scanForTwistIdInfo();
            await scanForTwistDataInfo();
        }
        // wait for x seconds
        await snooze(constants.BLOCK_SEARCH_INTERVAL * 1000);
    }
}

async function scanForTwistDataInfo() {
    var debug = constants.DEBUG;
	debug = true;

    // twist data
    var validTwistData = [];
    var ownerSet = new Set();
    var twistDataTxTxIds = new Set();

    var scannedBlocks = 1;
    var startBlock = constants.TWIST_DATA_SCAN_START_BLOCK;
    var endBlock;
    try {
        endBlock = await client.getBlockCount();
    } catch (err) {
        return;
    }

    // read from json
    try {
        if(constants.READ_DATA_FROM_JSON) {
            var filePath = utils.getTwistDataFilePath();
            var dataSource = await jsonfile.readFileSync(filePath);
            console.log("reading json data from " + filePath);
            // retrieve existing data from json file if possible
            if(dataSource != null && Object.keys(dataSource).length != 0) {
                // check last scanned block is valid
                if (!isNaN(dataSource.block) && dataSource.block <= endBlock) {
                    startBlock = dataSource.block;
                    if (debug) console.log('storage retrieved: block');
                }
                // check valid twist data tx's are in the correct format
                if (Array.isArray(dataSource.validTwistData)) {
                    validTwistData = dataSource.validTwistData;
                    if (debug) console.log('storage retrieved: validTwistData');
                }
                // check twist data owners are in the correct format
                if (Array.isArray(dataSource.ownerSet)) {
                    ownerSet = new Set(dataSource.ownerSet);
                    if (debug) console.log('storage retrieved: ownerSet');
                }
                // check twist data txId's are in the correct format
                if (Array.isArray(dataSource.twistDataTxTxIds)) {
                    twistDataTxTxIds = new Set(dataSource.twistDataTxTxIds);
                    if (debug) console.log('storage retrieved: twistDataTxTxIds');
                }
            }
        }
    } catch (err) {
        console.log('cannot read from json file');
        console.log('starting scan from block ' + startBlock);
    }

    scannedBlocks = startBlock;

    // scan transactions in each block
    for (var i = startBlock; i <= endBlock; i++) {
        if (debug) console.log('block: ' + i);
        var blockHash;
        var block;
        try {
            blockHash = await client.getBlockHash(i);
            block = await client.getBlock(blockHash);
        } catch (err) {
            return;
        }
        var blockTime = block.time;
        for (var j = 0; j < block.tx.length; j++) {
            var txId = block.tx[j];
            var res = null;
            var err = null;
            var altTx = null;
            var tx = null;
            altTx = await client.getTransaction(txId).catch((result, error) => {
                res = result.text;
                err = error;
            });
            if (altTx == null && (res == null || err != null)) {
                continue;
            }
            if (altTx != null) {
                tx = altTx;
            } else {
                tx = JSON.parse(res).result;
            }
            if (debug) console.log('tx');
            var vin = tx.vin;
            var vout = tx.vout;

            // only transactions that can be relevant are inspected
            // twist data transactions always have at least 10 vouts
            if (vout != null && vout.length >= 10) {
                if (debug) console.log('vout');

                // twist data tx
                var twistDataDetected = false;
                var twistDataTxFlagAddr = '';
                var twistDataTxAddrVal = [];

                for (var k = 0; k < vout.length; k++) {
                    if (vout[k]['scriptPubKey']['type'] === 'nonstandard') {
                        break;
                    }
                    var addr = vout[k]['scriptPubKey']['addresses'][0];
                    var val = vout[k]['value'];

                    // twist id tx
                    if (twistDataDetected) {
                        twistDataTxAddrVal.push({
                            'address': addr,
                            'amount': val
                        });
                    } else {
                        if (addr === constants.TWIST_DATA_PRIVATE_ADDRESS || addr === constants.TWIST_DATA_SHAREABLE_ADDRESS) {
                            twistDataTxFlagAddr = addr;
                            var fee = constants.TWIST_DATA_BASELINE_FEE;

                            // check they have paid the fee
                            if (val >= (0.90 * fee)) {
                                twistDataDetected = true;
                                k = -1; // start from the beginning (so we can log addresses)
                            }
                        }
                    }
                }
                
                // twist id tx
                if (twistDataDetected) {
                    if (debug) console.log('twist data tx detected');
                    if (debug) console.log("twistDataTxAddrVal: ", twistDataTxAddrVal);
                    
                    // list of all addresses
                    var approxPaid = 0;
                    var txAddresses = twistDataTxAddrVal.map(a => a.address);
                    // find index of twist data flag address
                    if (txAddresses[0] === twistDataTxFlagAddr) {
                        // remove first address (flag)
                        txAddresses.shift();

                        approxPaid = twistDataTxAddrVal[0].amount;
                        for(var u = 1; u < twistDataTxAddrVal.length; u++) {
                            approxPaid += twistDataTxAddrVal[u].amount;
                        }
                    } else if (txAddresses[1] === twistDataTxFlagAddr) {
                        // remove first 2 addresses (change and flag)
                        txAddresses.shift();
                        txAddresses.shift();

                        approxPaid = twistDataTxAddrVal[1].amount;
                        for(var u = 2; u < twistDataTxAddrVal.length; u++) {
                            approxPaid += twistDataTxAddrVal[u].amount;
                        }
                    } else {
                        // invalid tx
                        continue;
                    }

                    // tx type
                    var dataTxType = 'private';
                    if (twistDataTxFlagAddr === constants.TWIST_DATA_SHAREABLE_ADDRESS) {
                        dataTxType = 'shareable';
                    }

                    // extract info from remaining addresses to create twist data tx obj
                    var twistDataTxObj = base58.extractPayloadsFromTwistDataTxAddresses(txAddresses, dataTxType);
                    twistDataTxObj.fee = approxPaid;
                    twistDataTxObj.block = i;
                    twistDataTxObj.blockTime = blockTime;
                    twistDataTxObj.txId = txId;
                    twistDataTxObj.shortTxId = crypto.createHash('sha256').update(txId).digest('hex').substring(0, 8);

                    // validation checks
                    if( twistDataTxObj.owner.length != 20 ||
                        twistDataTxObj.initialPayload.length < 5) {
                            console.log("[Block " + twistDataTxObj.block + "] twist data tx validation failed for tx: " + txId);
                            continue;
                    }

                    // add to sets
                    if (!twistDataTxTxIds.has(twistDataTxObj.txId)) {
                        twistDataTxTxIds.add(twistDataTxObj.txId);
                        ownerSet.add(twistDataTxObj.owner);
                        validTwistData.push(twistDataTxObj);
                    }
                }
            }
        }
        scannedBlocks = i;
        // notify renderer of progress
        // only display 1 in 5000 blocks (for performance reasons)
        var display = false;
        if (scannedBlocks % 5000 === 0) {
            display = true;
        } else if (scannedBlocks == endBlock) {
            display = true;
        }

        if (display) {
            console.log('blocks-processed', {
                'current': scannedBlocks,
                'total': endBlock
            });
        }
    }
    if (debug) console.log('finished indexing twist data transactions');

    // save twist data info
    var twistDataInfoObj = {
        'block': scannedBlocks,
        'validTwistData': validTwistData,
        'twistDataTxTxIds': Array.from(twistDataTxTxIds),
        'ownerSet': Array.from(ownerSet),
    };
    
    // write to json
    var filePath = utils.getTwistDataFilePath();
    console.log('writing twist data info to json file', filePath);
    await jsonfile.writeFile(filePath, twistDataInfoObj, function (err) {
        if (err) {
            console.error(err);
        }
    });
}