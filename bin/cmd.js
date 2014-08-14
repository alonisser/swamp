"use strict";

var _               = require('lodash'),
    Q               = require('q'),
    fs              = require('fs'),
    path            = require('path'),
    npid            = require('npid'),
    utils           = require('./helper'),
    bash            = require('./bash'),
    child_process   = require('child_process'),
    program         = require('commander'),
    exec            = child_process.exec;

var SWAMP_FILE_NAME         = 'Swampfile.js',
    CLI_PATH                = '../cli/cli',
    WAIT_FOR_PID_FILE_MAX_RETRIES   = 10,
    WAIT_FOR_PID_FILE_INTERVAL      = 100;



function _setBaseDir(dir) {

    try {
        process.chdir(dir);
    } catch(err) {
        utils.log('* ' + dir + ' is not a valid Swamp directory (' + err + ')', utils.LOG_TYPE.ERROR);
        process.exit();
    }
}

function _getBaseDir() {
    return process.cwd();
}

function _getPIDFile() {
    return _getBaseDir() + '/swamp.pid';
}

function _executeBashCommand(command, service_name) {

    var deferred = Q.defer();

    if(_isSwampfileExist()) {

        _isSwampRunning()
            .then(function() {

                bash.executeCommand(deferred, command, service_name);

            })
            .fail(_swampNotRunningMessage);
    }

    return deferred.promise;
}

function _swampNotRunningMessage() {

    utils.log('* swamp is not running', utils.LOG_TYPE.WARN);

}

function _serviceNotProvided(action) {

    utils.log('* service not provided, use `swamp ' + action + ' <service_name>` or `swamp help` for more options', utils.LOG_TYPE.ERROR);

}

// verify that the process id is running and it belongs to this Swamp
function _verifyProcessIdAsync(pid) {

    var deferred = Q.defer();

    var verifyCommand = "ps aux | grep " + pid + " | awk '{print $11}' | grep -v grep";

    exec(verifyCommand, function(error, out, err) {

        var valid = out && (out.toLowerCase().indexOf('swamp') > -1 ||
                            out.toLowerCase().indexOf('node') > -1);

        if(valid) {
            deferred.resolve();
        } else {
            deferred.reject();
        }

    });

    return deferred.promise;

}

// removing the PID file, neccary
function _removePidFile() {

    utils.removeFile(_getPIDFile());

}

function _confirmCreatePrompt(override) {
    var swampfileBootstrap, filePath;

    if(override) {

        utils.log('Overriding `' + SWAMP_FILE_NAME + '`...', utils.LOG_TYPE.WARN);

    } else {

        utils.log('Creating bootstrap `' + SWAMP_FILE_NAME + '`...', utils.LOG_TYPE.INFO);

    }

    try {

        swampfileBootstrap = fs.readFileSync(path.resolve(__dirname, '../config/assets/' + SWAMP_FILE_NAME), 'utf8');

    } catch(e) {

        utils.log(e, utils.LOG_TYPE.ERROR);

    }

    filePath = path.resolve(_getBaseDir(), SWAMP_FILE_NAME);

    fs.writeFileSync(filePath, swampfileBootstrap);

    utils.log('`' + SWAMP_FILE_NAME + '` created successfully at `' + filePath + '`.', utils.LOG_TYPE.SUCCESS);
}

function _declineCreatePrompt() {

    utils.log('Bye Bye...', utils.LOG_TYPE.SUCCESS);
}

function _isSwampfileExist() {

    var swampConfPath = path.resolve(SWAMP_FILE_NAME);

    // check if Swampfile exist in cwd
    if (swampConfPath && !fs.existsSync(swampConfPath)) {

        utils.log('* can\'t find `Swampfile.js` in ' + (_getBaseDir()), utils.LOG_TYPE.ERROR);

        return false;
    }

    return true;

}

function _isSwampRunning() {

    var deferred = Q.defer();

    if(utils.fileExist(_getPIDFile())) {

        var pid = utils.readFile(_getPIDFile());

        pid = parseInt(pid);

        _verifyProcessIdAsync(pid)

            .then(function() {
                deferred.resolve(pid);
            })

            .fail(function() {
                _removePidFile();
                deferred.reject();

            });

    } else {
        deferred.reject();
    }

    return deferred.promise;
}

function _waitForPIDFile(success, fail, retries) {

    retries = retries || 1;

    if(utils.fileExist(_getPIDFile())) {

        success();

    } else {

        if(retries >= WAIT_FOR_PID_FILE_MAX_RETRIES) {

            fail();

        } else {

            setTimeout(function() {

                _waitForPIDFile(success, fail, retries++);

            }, WAIT_FOR_PID_FILE_INTERVAL);

        }
    }
}

module.exports.create = function() {

    // looking for SWAMP_FILE_NAME
    var swampConfPath = path.resolve(SWAMP_FILE_NAME);

    // check if Swampfile already exist
    if(swampConfPath && utils.fileExist(swampConfPath)) {

        utils.prompt(SWAMP_FILE_NAME + ' already exist in `' + _getBaseDir() + '`, override?', utils.LOG_TYPE.WARN, false)
            .then(_confirmCreatePrompt)
            .catch(_declineCreatePrompt);
    } else if(swampConfPath && !utils.isEmptyDir(_getBaseDir())) {

        utils.prompt(_getBaseDir() + ' is not empty, continue anyway?', utils.LOG_TYPE.WARN, false)
            .then(_confirmCreatePrompt)
            .catch(_declineCreatePrompt);

    } else {
        _confirmCreatePrompt();
    }
}

module.exports.up = function() {

    var deferred = Q.defer();

    if(!_isSwampfileExist()) {
        return false;
    }

    var pid;

    _isSwampRunning()
        .then(function(pid) {

            utils.log('* swamp is already running [' + pid + ']', utils.LOG_TYPE.INFO);

            deferred.reject();

        })
        .fail(function() {

            // create swamp PID file
            if(!require('./pid')(_getPIDFile(), true)) {

                deferred.reject();

            } else {

                // initiate swamp running sequence
                require('./runner')();

                deferred.resolve();

            }

        });

    return deferred.promise;
}

module.exports.reload = function() {

    utils.log('* reloading swamp...', utils.LOG_TYPE.INFO);

    module.exports.halt()

        .then(function() {

            module.exports.daemon();

        });
}

module.exports.daemon = function() {

    var deferred = Q.defer();

    var daemon_command = "nohup swamp up > /dev/null 2>&1 &";

    _isSwampRunning()
        .then(function(pid) {

            utils.log('* swamp is already running [' + pid + ']', utils.LOG_TYPE.INFO);

            deferred.reject();

        })

        .fail(function() {

            if(!_isSwampfileExist()) {

                deferred.reject();

            } else {

                utils.log('* running swamp...', utils.LOG_TYPE.INFO);

                // run swamp daemon
                exec(daemon_command, function(err) {

                    if(!err) {

                        _waitForPIDFile(function() {

                            utils.log('* done.', utils.LOG_TYPE.SUCCESS);

                            deferred.resolve();

                        }, function() {

                            deferred.reject();

                        });

                    } else {

                        deferred.reject();

                    }
                });

            }

        });

    return deferred.promise;

}

module.exports.halt = function() {

    var deferred = Q.defer();

    if(!_isSwampfileExist()) {

        deferred.reject();

    } else {

        _isSwampRunning()
            .then(function(pid) {

                utils.log('* halting swamp...', utils.LOG_TYPE.INFO);

                // halt the swamp process
                _executeBashCommand('halt').then(function() {

                    utils.log('* done.', utils.LOG_TYPE.SUCCESS);

                    deferred.resolve();

                }).fail(function(err) {

                    process.kill(pid);

                    npid.remove(_getPIDFile());

                });

            })

            .fail(function() {

                _swampNotRunningMessage();

                deferred.reject();

            });

    }

    return deferred.promise;
}

module.exports.status = function() {

    var deferred = Q.defer();

    if(!_isSwampfileExist()) {

        deferred.reject();

    } else {

        _isSwampRunning()
            .then(function(pid) {

                utils.log('* swamp is running [' + pid + ']', utils.LOG_TYPE.INFO);

                deferred.resolve();

            })

            .fail(function() {

                _swampNotRunningMessage();

                deferred.reject();

            });
    }

    return deferred.promise;
}

module.exports.cli = function() {

    if(_isSwampfileExist()) {

        _isSwampRunning()
            .then(function() {

                require(CLI_PATH);

            })
            .fail(_swampNotRunningMessage);
    }

}

module.exports.dashboard = function() {

    if(_isSwampfileExist()) {

        _isSwampRunning()
            .then(function() {

                _executeBashCommand('dashboard');

            })
            .fail(_swampNotRunningMessage);
    }
}

module.exports.state = function(service_name) {

    if(!service_name) {
        _serviceNotProvided('state');
        return false;
    }

    _executeBashCommand('state', service_name);
}

module.exports.stop = function(service_name) {

    if(!service_name) {
        _serviceNotProvided('stop');
        return false;
    }

    _executeBashCommand('stop', service_name);
}

module.exports.start = function(service_name) {

    if(!service_name) {
        _serviceNotProvided('start');
        return false;
    }

    _executeBashCommand('start', service_name);
}

module.exports.restart = function(service_name) {

    if(!service_name) {
        _serviceNotProvided('restart');
        return false;
    }

    _executeBashCommand('restart', service_name);
}

module.exports.startall = function() {

    _executeBashCommand('startall');

}

module.exports.stopall = function() {

    _executeBashCommand('stopall');

}

module.exports.restartall = function() {

    _executeBashCommand('restartall');

}

module.exports.stateall = function() {

    _executeBashCommand('stateall');

}

module.exports.path = function(swamp_path, defaultPath) {

    swamp_path = swamp_path || defaultPath;

    if(swamp_path) {
        _setBaseDir(swamp_path);
    }
}