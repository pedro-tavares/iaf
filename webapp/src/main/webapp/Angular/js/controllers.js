/**
 * MainCtrl - controller
 * Used on all pages except login/logout
 *
 */
function MainCtrl($scope, appConstants, Api, Hooks, $state, $location, Poller, Notification, dateFilter, $interval, Idle, $http, Misc, $uibModal) {
    $scope.loading = true;
    Pace.on("done", function() {
        if(appConstants.init == 0) {
            Api.Get("server/info", function(data) {
                appConstants.init = 2;
                if(!($location.path().indexOf("login") >= 0)) {
                    Idle.watch();
                    angular.element("body").removeClass("gray-bg");
                    angular.element(".main").show();
                    angular.element(".loading").hide();
                }

                var serverTime = Date.parse(new Date(data.serverTime).toUTCString());
                var localTime  = Date.parse(new Date().toUTCString());
                appConstants.timeOffset = serverTime - localTime;
                //setTime(appConstants.timeOffset);

                function updateTime() {
                    var serverDate = new Date();
                    serverDate.setTime(serverDate.getTime() - appConstants.timeOffset);
                    $scope.serverTime = dateFilter(serverDate, appConstants["console.dateFormat"]);
                }
                $interval(updateTime, 1000);
                updateTime();

                angular.element(".iaf-info").html("IAF " + data.version + ": " + data.name );

                $scope.configurations = data.configurations;

                //Was it able to retrieve the serverinfo without logging in?
                if(!$scope.loggedin) {
                    Idle.setTimeout(false);
                }
                Hooks.call("init", false);
            });
            appConstants.init = 1;
            Api.Get("environmentvariables", function(data) {
                if(data["Application Constants"]) {
                    appConstants = $.extend(appConstants, data["Application Constants"]);
                    Hooks.call("appConstants", appConstants);
                    var idleTime = (parseInt(appConstants["console.idle.time"]) > 0) ? parseInt(appConstants["console.idle.time"]) : false;
                    if(idleTime > 0) {
	                    var idleTimeout = (parseInt(appConstants["console.idle.timeout"]) > 0) ? parseInt(appConstants["console.idle.timeout"]) : false;
	                    Idle.setIdle(idleTime);
	                    Idle.setTimeout(idleTimeout);
                    }
                    else {
                        Idle.unwatch();
                    }
                }
            });
        }
    });

    var token = sessionStorage.getItem('authToken');
    $scope.loggedin = (token != null && token != "null") ? true : false;

    $scope.reloadRoute = function() {
        $state.reload();
    };

    $scope.alerts = [];

    $scope.addAlert = function(type, message) {
        var exists = false;
        for(alert in $scope.alerts) {
            if( $scope.alerts[alert].message == message)
                exists = true;
        }
        if(!exists)
            $scope.alerts.push({type: type, message: message});
    };

    $scope.closeAlert = function(index) {
        $scope.alerts.splice(index, 1);
    };

    $scope.adapterSummary = {
        started:0,
        stopped:0,
        starting:0,
        stopping:0,
        error:0
    };
    $scope.receiverSummary = {
        started:0,
        stopped:0,
        starting:0,
        stopping:0,
        error:0
    };
    $scope.messageSummary = {
        info:0,
        warn:0,
        error:0
    };

    Hooks.register("init:once", function() {
        /* Check IAF version */
        $http.get("https://api.github.com/repos/ibissource/iaf/releases").then(function(response) {
            if(!response  || !response.data) return false;

            var release = response.data[0]; //Not sure what ID to pick, smallest or latest?
            var newVersion = release.tag_name.substr(1);
            var currentVersion = appConstants["application.version"];
            var version = Misc.compare_version(newVersion, currentVersion);
            console.log("Checking IAF version with remote...", "Comparing version: '"+currentVersion+"' with latest release: '"+newVersion+"'.");

            if(version > 0) {
                $scope.release = release;
                Notification.add('fa-exclamation-circle', "IAF update available!", false, function() {
                    $location.path("iaf-update");
                });
            }
        });

        Api.Get("server/warnings", function(warnings) {
            for(i in warnings) {
                var warning = warnings[i];
                var type = "warning";
                if(warning.type && (warning.type == "exception" || warning.type == "severe")) {
                    type = "danger";
                }
                $scope.addAlert(type, warning.message);
            }
        });

        Api.Get("adapters", function(allAdapters) {
            Hooks.call("adaptersLoaded", allAdapters);

            $scope.adapters = allAdapters;
            $scope.displayAdapters = [];
            for(adapter in allAdapters) {
                $scope.adapterSummary[allAdapters[adapter].state] += 1;
                Poller.add("adapters/" + adapter, function(data) {
                    var oldAdapterData = $scope.adapters[data.name];
                    if(oldAdapterData != data) {
                        if(oldAdapterData.state != data.state) {
                            //Is it up or down? Something has happened.
                            $scope.adapterSummary[oldAdapterData.state] -= 1;
                            $scope.adapterSummary[data.state] += 1;
                        }
                        data.receiverStopped = false;
                        for(x in data.receivers) {
                            var oldReceiverData = ($scope.adapters[data.name].receivers) ? $scope.adapters[data.name].receivers[x] : {state: "unknown"};
                            if(oldReceiverData.state != data.receivers[x].state) {
                                $scope.receiverSummary[oldReceiverData.state] -= 1;
                                $scope.receiverSummary[data.receivers[x].state] += 1;
                            }
                            if(data.receivers[x].started == false)
                                data.receiverStopped = true;
                        }
                        data.hasSender = false;
                        for(x in data.pipes) {
                            if(data.pipes[x].sender) {
                                data.hasSender = true;
                            }
                        }

                        data.status = data.started ? ((data.receiverStopped) ? 'warning' : 'started') : 'stopped';
                        $scope.adapters[data.name] = data;

                        Hooks.call("adapterUpdated", data);
                    }
                }, true);
            }
        }, function() {
            $scope.addAlert('danger', "An error occured while trying to load adapters!");
        });
    });

    function updateMessageSummary() {
        var summary = {
            info:0,
            warn:0,
            error:0
        };
        for(adapterName in $scope.adapters) {
            var adapter = $scope.adapters[adapterName];
            for(i in adapter.messages) {
                var level = adapter.messages[i].level.toLowerCase();
                summary[level]++;
            }
        }
        $scope.messageSummary = summary;
    }
    $interval(updateMessageSummary, 5000);

    Hooks.register("adapterUpdated:once", function(adapter) {
        if($location.hash()) {
            angular.element("#"+$location.hash())[0].scrollIntoView();
        }
        $scope.loading = false;
    });
    Hooks.register("adapterUpdated", function(adapter) {
        var name = adapter.name;
        if(name.length > 20)
            name = name.substring(0, 17) + "...";
        if(adapter.started == true) {
            for(x in adapter.receivers) {
                if(adapter.receivers[x].started == false) {
                    Notification.add('fa-exclamation-circle', "Receiver '"+name+"' stopped!", false, function() {
                        $location.path("status");
                        $location.hash(adapter.name);
                    });
                }
            }
        }
        else {
            Notification.add('fa-exclamation-circle', "Adapter '"+name+"' stopped!", false, function() {
                $location.path("status");
                $location.hash(adapter.name);
            });
        }
    });

    $scope.resetNotificationCount = function() { Notification.resetCount(); };
    $scope.$watch(function () { return Notification.getCount(); }, function () {
        $scope.notificationCount = Notification.getCount();
        $scope.notificationList = Notification.getLatest(5);
    });

    $scope.$on('IdleStart', function () {
        var pollerObj = Poller.getAll();
        for(x in pollerObj) {
            Poller.changeInterval(pollerObj[x], appConstants["console.idle.pollerInterval"]);
        }

        var idleTimeout = (parseInt(appConstants["console.idle.timeout"]) > 0) ? parseInt(appConstants["console.idle.timeout"]) : false;
        if(!idleTimeout) return;

        swal({
            title: "Idle timer...",
            text: "Your session will be terminated in <span class='idleTimer'>60:00</span> minutes.",
            type: "warning",
            showConfirmButton: false,
            showCloseButton: true
        });
    });

    $scope.$on('IdleWarn', function (e, time) {
        var minutes = Math.floor(time/60);
        var seconds  = Math.round(time%60);
        if(minutes < 10) minutes = "0" + minutes;
        if(seconds < 10) seconds = "0" + seconds;
        var elm = angular.element(".swal2-container").find(".idleTimer");
        elm.text(minutes + ":" + seconds);
    });

    $scope.$on('IdleTimeout', function () {
        swal({
            title: "Idle timer...",
            text: "You have been logged out due to inactivity.",
            type: "info",
            showCloseButton: true
        });
        $location.path("logout");
    });

    $scope.$on('IdleEnd', function () {
        var elm = angular.element(".swal2-container").find(".swal2-close");
        elm.click();

        var pollerObj = Poller.getAll();
        for(x in pollerObj) {
            Poller.changeInterval(pollerObj[x], appConstants["console.pollerInterval"]);
        }
    });

    $scope.openInfoModel = function () {
        $uibModal.open({
            templateUrl: 'views/information.html',
//            size: 'sm',
            controller: InformationCtrl
        });
    };
};

function InformationCtrl($scope, $uibModalInstance, Api) {
    Api.Get("server/info", function(data) {
        $.extend( $scope, data );
    });
    $scope.close = function () {
        $uibModalInstance.close();
    };
};

function StatusCtrl($scope, Api, Hooks) {
    this.filter = {
        "started": true,
        "stopped": true,
        "warning": true
    };
    $scope.filter = this.filter;
    $scope.hideAdapter = {};
    $scope.applyFilter = function(filter) {
        $scope.filter = filter;
        applyStatusFilter();
    };
    function applyStatusFilter() {
        for(adapterName in $scope.adapters) {
            var adapter = $scope.adapters[adapterName];
            $scope.hideAdapter[adapter.name] = false;
            for(x in $scope.filter) {
                if($scope.filter[x] == false && adapter.status == x) {
                    $scope.hideAdapter[adapter.name] = true;
                }
            }
        }
        applyConfigFilter();
    }
    function applyConfigFilter() {
        for(adapterName in $scope.adapters) {
            var adapter = $scope.adapters[adapterName];
            if($scope.hideAdapter[adapter.name] === true) continue;
            $scope.hideAdapter[adapter.name] = (adapter.configuration == $scope.selectedConfiguration || $scope.selectedConfiguration == "All") ? false : true;
        }
    }

    $scope.collapseAll = function() {
        $(".adapters").each(function(i,e) {
            var ibox = $(e);
            var icon = ibox.find(".ibox-tools").find('i:first');
            var content = ibox.find('div.ibox-content');
            content.slideUp(200);
            icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
        });
    };
    $scope.expandAll = function() {
        $(".adapters").each(function(i,e) {
            var ibox = $(e);
            var icon = ibox.find(".ibox-tools").find('i:first');
            var content = ibox.find('div.ibox-content');
            content.slideDown(200);
            icon.addClass('fa-chevron-down').removeClass('fa-chevron-up');
        });
    };
    $scope.stopAll = function() {
        var adapters = Array();
        for(adapter in $scope.adapters) {
            if($scope.hideAdapter[adapter] === true) continue;
           adapters.push(adapter);
        }
        Api.Put("adapters", {"action": "stop", "adapters": adapters});
    };
    $scope.startAll = function() {
        var adapters = Array();
        for(adapter in $scope.adapters) {
            if($scope.hideAdapter[adapter] === true) continue;
           adapters.push(adapter);
        }
        Api.Put("adapters", {"action": "start", "adapters": adapters});
    };
    $scope.reloadConfiguration = function() {
        swal("Method not yet implemented!");
    };
    $scope.fullReload = function() {
        swal("Method not yet implemented!");
    };
    $scope.showReferences = function() {
        swal("Method not yet implemented!");
    };

    $scope.selectedConfiguration = "All";
    $scope.changeConfiguration = function(name) {
        $scope.selectedConfiguration = name;
        applyStatusFilter();
    };

    Hooks.register("adapterUpdated:1", function(adapter) {
        $scope.hideAdapter[adapter.name] = false;
        for(x in $scope.filter) {
            if($scope.filter[x] == false && adapter.status == x) {
                $scope.hideAdapter[adapter.name] = true;
            }
        }
    });

    $scope.startAdapter = function(adapter) {
        Api.Put("adapters/" + adapter, {"action": "start"});
    };
    $scope.stopAdapter = function(adapter) {
        Api.Put("adapters/" + adapter, {"action": "stop"});
    };
    $scope.startReceiver = function(adapter, receiver) {
        Api.Put("adapters/" + adapter + "/receivers/" + receiver, {"action": "start"});
    };
    $scope.stopReceiver = function(adapter, receiver) {
        Api.Put("adapters/" + adapter + "/receivers/" + receiver, {"action": "stop"});
    };
};

function LoadingCtrl($scope) {
    $scope.$on('loading', function(event, loading) { $scope.loading = loading; });
};
function LogoutCtrl($scope, Poller, authService, Idle) {
    var pollerObj = Poller.getAll();
    for(x in pollerObj) {
        Poller.remove(pollerObj[x]);
    }
    Idle.unwatch();
    authService.logout();
};
function LoginCtrl($scope, authService, $timeout,  appConstants, Alert, $interval) {
    /*$interval(function() {
        $scope.notifications = Alert.get(true);
    }, 200);*/
    $timeout(function() {
        $scope.notifications = Alert.get();
        angular.element(".main").show();
        angular.element(".loading").hide();
        angular.element("body").addClass("gray-bg");
    }, 500);
    authService.loggedin(); //Check whether or not the client is logged in.
    $scope.credentials = {};
    $scope.login = function(credentials) {
        authService.login(credentials.username, credentials.password);
    };
};

function NotificationsCtrl($scope, Api, $stateParams, Hooks, Notification) {
    if($stateParams.id > 0) {
        $scope.notification = Notification.get($stateParams.id);
    }
    else {
        $scope.text = ("Showing a list with all notifications!");
    }

    Hooks.register("adapterUpdated:2", function(adapter) {
        console.warn("What is the scope of: ", adapter);
    });
};

function TranslateCtrl($translate, $scope) {
    $scope.changeLanguage = function (langKey) {
        $translate.use(langKey);
        $scope.language = langKey;
    };
};


function ShowConfigurationCtrl($scope, Api) {
    this.configurationRadio = 'true';
    $scope.selectedConfiguration = "All";
    $scope.loadedConfiguration = true;

    $scope.loadedConfig = function(bool) {
        $scope.loadedConfiguration = (bool == "true") ? true : false;
        getConfiguration();
    };

    $scope.changeConfiguration = function(name) {
        $scope.selectedConfiguration = name;
        getConfiguration();
    };

    getConfiguration = function() {
        var uri = "configurations";
        if($scope.selectedConfiguration != "All") uri += "/" + $scope.selectedConfiguration;
        if($scope.loadedConfiguration) uri += "?loadedConfiguration=true";
        Api.Get(uri, function(data) {
            $scope.configuration = data;
        });
    };
    getConfiguration();
};

function EnvironmentVariablesCtrl($scope, Api, appConstants) {
    $scope.variables = [];
    Api.Get("environmentvariables", function(data) {
        $scope.variables = data;
    });
};

function AdapterStatisticsCtrl($scope, Api, $stateParams) {
    var adapterName = $stateParams.name;
    if(!adapterName)
        return swal("Adapter not found!");
    $scope.adapterName = adapterName;

    $scope.stats = [];
    Api.Get("adapters/"+adapterName+"/statistics", function(data) {
        $scope.stats = data;
    });
};

function SecurityItemsCtrl($scope, Api) {
    $scope.monitors = [];
    $scope.enabled = false;
    $scope.destinations = [];
    Api.Get("securityitems", function(data) {
        $scope.enabled = data.enabled;
        $scope.monitors = data.monitors;
        $scope.destinations = data.destinations;
    });
};

function SchedulerCtrl($scope, Api) {
};

function LoggingCtrl($scope, Api) {
};

function IBISstoreSummaryCtrl($scope, Api) {
};

function SendJmsMessageCtrl($scope, Api) {
};

function BrowseJmsQueueCtrl($scope, Api) {
};

function ExecuteJdbcQueryCtrl($scope, Api, $timeout, $state) {
    $scope.jmsRealms = {};
    $scope.resultTypes = {};
    $scope.error = "";
    Api.Get("jdbc", function(data) {
        $scope.jmsRealms = data.jmsRealms;
        $scope.resultTypes = data.resultTypes;
    });
    $scope.submit = function(formData) {
        if(!formData || !formData.query) {
            $scope.error = "Please specify a jms realm, resulttype and query!";
            return;
        }
        if(!formData.realm) formData.realm = $scope.jmsRealms[0] || false;
        if(!formData.resultType) formData.resultType = $scope.resultTypes[0] || false;

        Api.Post("jdbc/query", JSON.stringify(formData), function(returnData) {
            $scope.error = "";
            $scope.result = returnData;
        }, function(errorData, status, errorMsg) {
            var error = (errorData) ? errorData : errorMsg;
            $scope.error = error;
            $scope.result = "";
        });
    };
    $scope.reset = function() {
        $scope.form.query = "";
        $scope.result = "";
    };
};

function BrowseJdbcTablesCtrl($scope, Api, $timeout, $state) {
    $scope.jmsRealms = {};
    $scope.resultTypes = {};
    $scope.error = "";
    var orderedGroups = ['rare', 'uncommon', 'common'];
    $scope.groupComparator = function(item) {
        return orderedGroups.indexOf(item.group);
    };
    Api.Get("jdbc", function(data) {
        $scope.jmsRealms = data.jmsRealms;
    });
    $scope.submit = function(formData) {
        if(!formData || !formData.table) {
            $scope.error = "Please specify a jms realm and table name!";
            return;
        }
        if(!formData.realm) formData.realm = $scope.jmsRealms[0] || false;
        if(!formData.resultType) formData.resultType = $scope.resultTypes[0] || false;

        Api.Post("jdbc/browse", JSON.stringify(formData), function(returnData) {
            $scope.error = "";
            $scope.query = returnData.query;
            $timeout(function(){
                var thead = angular.element("table.jdbcBrowse thead");
                var tbody = angular.element("table.jdbcBrowse tbody");
                thead = thead.empty().append("<tr></tr>").find("tr");
                tbody.empty();
                var index = [];
                thead.append("<th>RNUM</th>");
                index.push("RNUM");
                for(x in returnData.fielddefinition) {
                    index.push(x);
                    if(formData.minRow == undefined && formData.maxRow == undefined)
                        x = x + " " + returnData.fielddefinition[x];
                    thead.append("<th>"+x+"</th>");
                }
                for(x in returnData.result) {
                    var tableRow = $("<tr></tr>");
                    var row = returnData.result[x];
                    for(def in row) {
                        var p = "";
                        if(returnData.result.length == 1 && def.indexOf("LENGTH ") == 0) {
                            def.replace("LENGTH ", "");
                            p = " (length)";
                        }
                        tableRow.append("<td>"+row[def] + p+"</td>");
                    }
                    tbody.append(tableRow);
                };
            }, 100);
        }, function(errorData, status, errorMsg) {
            var error = (errorData) ? errorData : errorMsg;
            $scope.error = error;
            $scope.query = "";
        });
    };
    $scope.reset = function() {
        $scope.result = "";
    };
};

function ShowMonitorsCtrl($scope, Api) {
    $scope.monitors = [];
    $scope.enabled = false;
    $scope.destinations = [];
    Api.Get("monitors", function(data) {
        $scope.enabled = data.enabled;
        $scope.monitors = data.monitors;
        $scope.destinations = data.destinations;
    });
};

function TestPipelineCtrl($scope, Api, Alert, $interval) {
    $scope.state = [];
    $scope.file = null;
    $scope.addNote = function(type, message, removeQueue) {
        $scope.state.push({type:type, message: message});
    };
    $scope.handleFile = function(files) {
        if(files.length == 0) {
            $scope.file = null;
            return;
        }
        $scope.file = files[0]; //Can only parse 1 file!
    };
    $scope.submit = function(formData) {
        $scope.result = "";
        $scope.state = [];
        if(!formData) return;

        var fd = new FormData();
        if(formData.adapter && formData.adapter != "")
            fd.append("adapter", formData.adapter);
        if(formData.encoding && formData.encoding != "")
            fd.append("encoding", formData.encoding);
        if(formData.message && formData.message != "")
            fd.append("message", formData.message);
        if($scope.file)
            fd.append("file", $scope.file, $scope.file.name);
        
        if(!formData) {
            $scope.addNote("warning", "Please specify an adapter and message!");
            return;
        }
        if(!formData.adapter) {
            $scope.addNote("warning", "Please specify an adapter!");
            return;
        }
        if(!formData.message && !formData.file) {
            $scope.addNote("warning", "Please specify a file or message!");
            return;
        }
        Api.Post("test-pipeline", fd, { 'Content-Type': undefined }, function(returnData) {
            var warnLevel = "success";
            if(returnData.state == "ERROR") warnLevel = "danger";
            $scope.addNote(warnLevel, returnData.state);
            $scope.result = (returnData.result);
        }, function(returnData) {
            $scope.addNote("danger", returnData.state);
            $scope.result = (returnData.result);
        });
    };
};

function TestServiceListenerCtrl($scope, Api, Alert, $interval) {
    $scope.state = [];
    $scope.file = null;
    $scope.addNote = function(type, message, removeQueue) {
        $scope.state.push({type:type, message: message});
    };
    $scope.handleFile = function(files) {
        if(files.length == 0) {
            $scope.file = null;
            return;
        }
        $scope.file = files[0]; //Can only parse 1 file!
    };
    $scope.submit = function(formData) {
        $scope.result = "";
        $scope.state = [];
        if(!formData) return;

        var fd = new FormData();
        if(formData.service && formData.service != "")
            fd.append("service", formData.service);
        if(formData.encoding && formData.encoding != "")
            fd.append("encoding", formData.encoding);
        if(formData.message && formData.message != "")
            fd.append("message", formData.message);
        if($scope.file)
            fd.append("file", $scope.file, $scope.file.name);
        
        if(!formData) {
            $scope.addNote("warning", "Please specify a service and message!");
            return;
        }
        if(!formData.adapter) {
            $scope.addNote("warning", "Please specify a service!");
            return;
        }
        if(!formData.message && !formData.file) {
            $scope.addNote("warning", "Please specify a file or message!");
            return;
        }
        Api.Post("test-servicelistener", fd, function(returnData) {
            var warnLevel = "success";
            if(returnData.state == "ERROR") warnLevel = "danger";
            $scope.addNote(warnLevel, returnData.state);
            $scope.result = (returnData.result);
        }, function(returnData) {
            $scope.addNote("danger", returnData.state);
            $scope.result = (returnData.result);
        });
    };
};

angular
    .module('iaf.beheerconsole')
    .controller('LoginCtrl', LoginCtrl)
    .controller('LogoutCtrl', LogoutCtrl)
    .controller('LoadingCtrl', LoadingCtrl)
    .controller('MainCtrl', MainCtrl)
    .controller('StatusCtrl', StatusCtrl)
    .controller('NotificationsCtrl', NotificationsCtrl)
    .controller('TranslateCtrl', TranslateCtrl)

    .controller('ShowConfigurationCtrl', ShowConfigurationCtrl)
    .controller('EnvironmentVariablesCtrl', EnvironmentVariablesCtrl)
    .controller('AdapterStatisticsCtrl', AdapterStatisticsCtrl)
    .controller('SecurityItemsCtrl', SecurityItemsCtrl)
    .controller('SchedulerCtrl', SchedulerCtrl)
    .controller('LoggingCtrl', LoggingCtrl)
    .controller('IBISstoreSummaryCtrl', IBISstoreSummaryCtrl)
    .controller('SendJmsMessageCtrl', SendJmsMessageCtrl)
    .controller('BrowseJmsQueueCtrl', BrowseJmsQueueCtrl)
    .controller('ExecuteJdbcQueryCtrl', ExecuteJdbcQueryCtrl)
    .controller('BrowseJdbcTablesCtrl', BrowseJdbcTablesCtrl)
    .controller('ShowMonitorsCtrl', ShowMonitorsCtrl)
    .controller('TestPipelineCtrl', TestPipelineCtrl)
    .controller('TestServiceListenerCtrl', TestServiceListenerCtrl);