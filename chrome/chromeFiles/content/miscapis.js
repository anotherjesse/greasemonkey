function GM_ScriptStorage(script) {
  this.prefMan = new GM_PrefManager(["scriptvals.",
                                     script.namespace,
                                     "/",
                                     script.name,
                                     "."].join(""));
};

GM_ScriptStorage.prototype.setValue = function(name, val) {
  GM_apiLeakCheck();

  if (GM_apiLeakCheck()) {
    alert('ALERT ALERT detected leaked GM_ API, aborting!\n');
    return;
  }

  this.prefMan.setValue(name, val);
};

GM_ScriptStorage.prototype.getValue = function(name, defVal) {
  GM_apiLeakCheck();

  return this.prefMan.getValue(name, defVal);
};

function GM_Resources(script){
  this.script = script;
};

GM_Resources.prototype.getResourceURL = function(name) {
  GM_apiLeakCheck();

  var dep = this.getDep_(name);

  var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService(Components.interfaces.nsIIOService);
  var appSvc = Components.classes["@mozilla.org/appshell/appShellService;1"]
                         .getService(Components.interfaces.nsIAppShellService);

  var window = appSvc.hiddenDOMWindow;
  var binaryContents = getBinaryContents(getDependencyFileURI(this.script, dep));

  var mimetype = dep.mimetype;
  if(dep.charset && dep.charset.length > 0){
    mimetype += ";charset=" + dep.charset;
  }

  return "data:" + mimetype + ";base64," +
    window.encodeURIComponent(window.btoa(binaryContents));
};

GM_Resources.prototype.getResourceText = function(name) {
  GM_apiLeakCheck();

  var dep = this.getDep_(name);
  return getContents(getDependencyFileURI(this.script, dep));
};

GM_Resources.prototype.getDep_ = function(name) {
  for (var i=0; i< this.script.resources.length; i++){
    var d = this.script.resources[i]
    if (d.name == name) {
      return d;
    }
  }
  throw new Error("No resource with name: " + name); // NOTE: Non localised string
};

function GM_ScriptLogger(script) {
  var namespace = script.namespace;

  if (namespace.substring(namespace.length - 1) != "/") {
    namespace += "/";
  }

  this.prefix = [namespace, script.name, ": "].join("");
};

GM_ScriptLogger.prototype.log = function(message) {
  GM_apiLeakCheck();

  GM_log(this.prefix + message, true);
};


// Based on Mark Pilgrim's GM_addGlobalStyle from
// http://diveintogreasemonkey.org/patterns/add-css.html. Used by permission
// under GPL: http://diveintogreasemonkey.org/license/gpl.html
function GM_addStyle(doc, css) {
  var head, style;
  head = doc.getElementsByTagName('head')[0];
  if (!head) { return; }
  style = doc.createElement('style');
  style.type = 'text/css';
  style.innerHTML = css;
  head.appendChild(style);
};

function GM_console(script) {
  // based on http://www.getfirebug.com/firebug/firebugx.js
  var names = [
    "debug", "warn", "error", "info", "assert", "dir", "dirxml",
    "group", "groupEnd", "time", "timeEnd", "count", "trace", "profile",
    "profileEnd"
  ];

  for (var i=0, name; name=names[i]; i++) {
    this[name] = function() {};
  }

  // Important to use this private variable so that user scripts can't make
  // this call something else by redefining <this> or <logger>.
  var logger = new GM_ScriptLogger(script);
  this.log = function() {
    logger.log(
      Array.prototype.slice.apply(arguments).join('\n')
    );
  };
};

GM_console.prototype.log = function() {
};