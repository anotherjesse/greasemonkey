function ScriptDownloader(win, uri, bundle) {
  this.win_ = win;
  this.uri_ = uri;
  this.bundle_ = bundle;
  this.req_ = null;
  this.script = null;
  this.depQueue_ = [];
  this.dependenciesLoaded_ = false;
  this.installOnCompletion_ = false;
};

ScriptDownloader.prototype.startInstall = function() {
  this.installing_ = true;
  this.startDownload();
};

ScriptDownloader.prototype.startViewScript = function(uri) {
  this.installing_ = false;
  this.startDownload();
};

ScriptDownloader.prototype.startDownload = function() {
  this.win_.GM_BrowserUI.statusImage.src = "chrome://global/skin/throbber/Throbber-small.gif";
  this.win_.GM_BrowserUI.statusImage.style.opacity = "0.5";
  this.win_.GM_BrowserUI.statusImage.tooltipText = this.bundle_.getString("tooltip.loading");

  this.win_.GM_BrowserUI.showStatus("Fetching user script", false);

  Components.classes["@greasemonkey.mozdev.org/greasemonkey-service;1"]
    .getService().wrappedJSObject
    .ignoreNextScript();

  this.req_ = new XMLHttpRequest();
  this.req_.open("GET", this.uri_.spec, true);
  this.req_.onload = GM_hitch(this, "handleScriptDownloadComplete");
  this.req_.send(null);
};

ScriptDownloader.prototype.handleScriptDownloadComplete = function() {
  this.win_.GM_BrowserUI.refreshStatus();
  this.win_.GM_BrowserUI.hideStatusImmediately();

  try {
    // If loading from file, status might be zero on success
    if (this.req_.status != 200 && this.req_.status != 0) {
      // NOTE: i18n
      alert("Error loading user script:\n" +
            this.req_.status + ": " +
            this.req_.statusText);
      return;
    }

    var source = this.req_.responseText;

    this.parseScript(source, this.uri_);

    var file = Components.classes["@mozilla.org/file/directory_service;1"]
                         .getService(Components.interfaces.nsIProperties)
                         .get("TmpD", Components.interfaces.nsILocalFile);

    var base = this.script.name.replace(/[^A-Z0-9_]/gi, "").toLowerCase();
    file.append(base + ".user.js");

    var converter =
      Components.classes["@mozilla.org/intl/scriptableunicodeconverter"]
        .createInstance(Components.interfaces.nsIScriptableUnicodeConverter);
    converter.charset = "UTF-8";
    source = converter.ConvertFromUnicode(source);

    var ws = getWriteStream(file);
    ws.write(source, source.length);
    ws.close();

    this.script.file = file;

    window.setTimeout(GM_hitch(this, "fetchDependencies"), 0);

    if (this.installing_) {
      this.showInstallDialog();
    } else {
      this.showScriptView();
    }
  } catch (e) {
    // NOTE: i18n
    alert("Script could not be installed " + e);
    throw e;
  }
};

ScriptDownloader.prototype.fetchDependencies = function(){
  GM_log("Fetching Dependencies");
  var dep, deps = this.script.requires.concat(this.script.resources);
  while ((dep = deps.shift())) {
    if (this.checkDependencyURL(dep.url)) {
      this.depQueue_.push(dep);
    } else {
      var error = new Error("SecurityException: " +
                            "Request to local and chrome urls is forbidden");
      this.errorInstallDependency(error, dep);
      return;
    }
  }
  this.downloadNextDependency();
};

ScriptDownloader.prototype.downloadNextDependency = function() {
  if (this.depQueue_.length > 0) {
    var dep = this.depQueue_.pop();
    this.downloadFile(dep.url, "handleDependencyDownloadComplete",
                      "errorInstallDependency", dep);
  } else {
    this.dependenciesLoaded_ = true;
    this.finishInstall();
  }
};

ScriptDownloader.prototype.handleDependencyDownloadComplete =
function(file, channel, dep) {
  GM_log("Dependency Download complete " + dep.url);
  try {
    var httpChannel =
      channel.QueryInterface(Components.interfaces.nsIHttpChannel);
  } catch(e) {
    var httpChannel = false;
  }

  if (httpChannel) {
    if (httpChannel.requestSucceeded) {
      dep.file = file;
      if (dep.hasOwnProperty("mimetype"))
        dep.mimetype = channel.contentType;
      if (channel.contentCharset) {
        dep.charset = channel.contentCharset;
      }
      this.downloadNextDependency();
    } else {
      var error = new Error("Error! Server returned: " +
                            httpChannel.responseStatus + ": " +
                            httpChannel.responseStatusText);
      this.errorInstallDependency(error, dep);
    }
  } else {
    dep.file = file;
    this.downloadNextDependency();
  }
};

ScriptDownloader.prototype.checkDependencyURL = function(url) {
  var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService(Components.interfaces.nsIIOService);
  var scheme = ioService.extractScheme(url);

  switch (scheme) {
    case "http":
    case "https":
    case "ftp":
        return true;
    case "file":
        var scriptScheme = ioService.extractScheme(this.uri_.spec);
        return (scriptScheme == "file");
    default:
      return false;
  }
};

ScriptDownloader.prototype.finishInstall = function(){
  if (this.installOnCompletion_) {
    this.installScript();
  }
};

ScriptDownloader.prototype.errorInstallDependency = function(e, dep) {
  var msg = e.message;
  GM_log("Error loading dependency " + dep.url + "\n" + msg)
  if (this.installOnCompletion_) {
    alert("Error loading dependency " + dep.url + "\n" + msg);
  } else {
    this.dependencyError = "Error loading dependency " + dep.url + "\n" + msg;
  }
};

ScriptDownloader.prototype.installScript = function(){
  if (this.dependencyError) {
    alert(this.dependencyError);
  } else if(this.dependenciesLoaded_) {
    this.win_.GM_BrowserUI.installScript(this.script)
  } else {
    this.installOnCompletion_ = true;
  }
};

ScriptDownloader.prototype.showInstallDialog = function(timer) {
  if (!timer) {
    // otherwise, the status bar stays in the loading state.
    this.win_.setTimeout(GM_hitch(this, "showInstallDialog", true), 0);
    return;
  }
  this.win_.openDialog("chrome://greasemonkey/content/install.xul", "",
                       "chrome,centerscreen,modal,dialog,titlebar,resizable",
                       this);
};

ScriptDownloader.prototype.showScriptView = function() {
  this.win_.GM_BrowserUI.showScriptView(this);
};

ScriptDownloader.prototype.parseScript = function(source, uri, script, headers) {
  function resolveURL(url, baseurl) {
    url = ioservice.newURI(url, null, baseurl);
    return url.spec;
  }
  var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService();

  headers = GM_parseScriptHeaders(source, {
    // verbatim string, last value only:
    name:1,
    namespace:1,
    description:1,

    // verbatim array of strings, all occurrences:
    include:0,
    exclude:0,

    // derived data, all occurrences:
    require:function(url, prior) {
      url = resolveURL(url, uri);
      if (url == uri.spec)
        return null;
      for (var i = 0; i < prior.length; i++) {
        var seen = prior[i];
        if (seen && seen.url == url)
          return null;
      }
      return new ScriptDependency(url);
    },
    resource:function(name_url, prior) {
      var args = name_url.match(/(\S+)\s+(.*)/);
      if (args === null) {
        throw new Error("Invalid syntax for @resource declaration '" +
                        name_url + "'. Resources are declared like: " +
                        "@resource <name> <url>."); // TODO: i18n
      }
      var name = args[1];
      for (var i = 0; i < prior.length; i++) {
        if (prior[i].name == name)
          throw new Error("Duplicate resource name '" + resName + "' " +
                          "detected. Each resource must have a unique " +
                          "name."); // TODO: i18n
      }
      var url = args[2];
      return new ScriptResource(name, resolveURL(url, uri));
    }
  }, headers);

  if (!script) {
    script = this.script = new Script();
    script.uri = uri;
    script.enabled = true;
    script.name = headers.name || parseScriptName(uri);
    script.namespace = headers.namespace || uri.host;
    script.description = headers.description || "";
  }
  script.includes = headers.include || ["*"];
  script.excludes = headers.exclude || [];
  script.requires = (headers.require || []).filter(function(r) { return r; });
  script.resources = headers.resource || [];

  return headers;
};

/**
 * Download and save url into a temporary file. On successful completion, call
 * onOK(file, channel), otherwise onFail(exception). Additional arguments get
 * passed on to either callback, and the this object is retained.
 */
ScriptDownloader.prototype.downloadFile = function(url, onOK, onFail) {
  var args = [].slice.call(arguments, 3); // trailing args for the callbacks
  try {
    var ioservice =
      Components.classes["@mozilla.org/network/io-service;1"].getService();
    var uri = ioservice.newURI(url, null, null);

    var channel = ioservice.newChannelFromURI(uri);
    channel.notificationCallbacks = new NotificationCallbacks();

    var file = getTempFile();

    args.unshift(this, onOK, file, channel);
    onOK = GM_hitch.apply(this, args);
    var progressListener = new PersistProgressListener(onOK);
    progressListener.persist.saveChannel(channel, file);
  } catch(e) {
    GM_log("Download exception " + e);
    args.unshift(this, onFail, e);
    onFail = GM_hitch.apply(this, args);
    onFail();
  }
}

function NotificationCallbacks() {
};

NotificationCallbacks.prototype.QueryInterface = function(aIID) {
  if (aIID.equals(Components.interfaces.nsIInterfaceRequestor)) {
    return this;
  }
  throw Components.results.NS_NOINTERFACE;
};

NotificationCallbacks.prototype.getInterface = function(aIID) {
  if (aIID.equals(Components.interfaces.nsIAuthPrompt )) {
     var winWat = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                            .getService(Components.interfaces.nsIWindowWatcher);
     return winWat.getNewAuthPrompter(winWat.activeWindow);
  }
  return undefined;
};


function PersistProgressListener(doneCallback) {
  var persist = Components.classes[
    "@mozilla.org/embedding/browser/nsWebBrowserPersist;1"]
    .createInstance(Components.interfaces.nsIWebBrowserPersist);
  persist.persistFlags =
    persist.PERSIST_FLAGS_BYPASS_CACHE |
    persist.PERSIST_FLAGS_REPLACE_EXISTING_FILES; //doesn't work?
  persist.progressListener = this;

  this.onFinish = doneCallback;
  this.persist = persist;
};

PersistProgressListener.prototype.QueryInterface = function(aIID) {
 if (aIID.equals(Components.interfaces.nsIWebProgressListener)) {
   return this;
 }
 throw Components.results.NS_NOINTERFACE;
};

// nsIWebProgressListener
PersistProgressListener.prototype.onProgressChange =
  PersistProgressListener.prototype.onLocationChange =
    PersistProgressListener.prototype.onStatusChange =
      PersistProgressListener.prototype.onSecurityChange = function(){};

PersistProgressListener.prototype.onStateChange =
  function(aWebProgress, aRequest, aStateFlags, aStatus) {
    if (this.persist.currentState == this.persist.PERSIST_STATE_FINISHED) {
      GM_log("Persister: Download complete " + aRequest.status);
      this.onFinish();
    }
  };
