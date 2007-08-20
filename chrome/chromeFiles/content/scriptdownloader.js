function ScriptDownloader(win, uri, bundle) {
  this.win_ = win;
  this.uri_ = uri;
  this.bundle_ = bundle;
  this.req_ = null;
  this.script = null;
}

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

  Components.classes["@greasemonkey.mozdev.org/greasemonkey-service;1"]
  .getService().wrappedJSObject
  .ignoreNextScript();

  this.req_ = new XMLHttpRequest();
  this.req_.open("GET", this.uri_.spec, true);
  this.req_.onload = GM_hitch(this, "handleDownloadComplete");
  this.req_.send(null);
};

ScriptDownloader.prototype.handleDownloadComplete = function() {
  this.win_.GM_BrowserUI.refreshStatus();

  // If loading from file, status might be zero on success
  if (this.req_.status != 200 && this.req_.status != 0) {
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
  this.win_.GM_BrowserUI.hideStatus();

  if (this.installing_) {
    this.showInstallDialog();
  } else {
    this.showScriptView();
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

// Returns an associative array from header name to header values. Values are
// arrays, unless headers[name] == 1, in which case the value is a string only.
// The headers object, if provided, lists which headers you want, and whether
// you want all occurrences, or just the last one. Gets all headers by default.
ScriptDownloader.prototype.parseHeaders = function(source, headers) {
  var headerRe = /.*/;
  if (headers) {
    var allHeaders = [];
    for (var header in headers)
      allHeaders.push(header);
    headerRe = new RegExp( "^(" + allHeaders.join("|") + ")$" );
  }

  // read one line at a time looking for start meta delimiter or EOF
  var lines = source.match(/.+/g);
  var lnIdx = 0;
  var result;
  var foundMeta = false;
  var headers = {};

  while (result = lines[lnIdx++]) {
    if (result.indexOf("// ==UserScript==") == 0) {
      GM_log("* found metadata");
      foundMeta = true;
      break;
    }
  }

  // gather up meta lines
  if (foundMeta) {
    while (result = lines[lnIdx++]) {
      if (result.indexOf("// ==/UserScript==") == 0) {
        break;
      }

      var match = result.match(/\/\/ \@(\S+)\s+([^\n]+)/);
      if (match != null) {
        var name = match[1], value = match[2];
        if (!name.match(headerRe))
          continue;
        if (headers && headers[name])
          headers[name] = value; // only wanted the last value
        else { // want an array of all values
          if (!headers.hasOwnProperty(name))
            headers[name] = [];
          headers[name].push(value);
        }
      }
    }
  }
  return headers;
};

ScriptDownloader.prototype.parseScript = function(source, uri) {
  var script = new Script();
  script.uri = uri;
  script.enabled = true;

  var headers = this.parseHeaders(source,
                                  { name:1, namespace:1, description:1,
                                    include:0, exclude:0 } );

  script.name = headers.name || parseScriptName(uri);
  script.namespace = headers.namespace || uri.host;
  script.description = headers.description || "";
  script.includes = headers.include || [];
  script.excludes = headers.exclude || ["*"];

  this.script = script;
};
