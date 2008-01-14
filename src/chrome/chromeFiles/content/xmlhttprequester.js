function GM_xmlhttpRequester(unsafeContentWin, safeContentWin, chromeWindow) {
  this.unsafeContentWin = unsafeContentWin;
  this.safeContentWin = safeContentWin;
  this.chromeWindow = chromeWindow;
  this.currentUri_ = null;
  this.remoteUri_ = null;
  this.req_ = null;
};

// this function gets called by user scripts in content security scope to
// start a cross-domain xmlhttp request.
//
// details should look like:
// {method,url,onload,onerror,onreadystatechange,headers,data}
// headers should be in the form {name:value,name:value,etc}
// can't support mimetype because i think it's only used for forcing
// text/xml and we can't support that
GM_xmlhttpRequester.prototype.contentStartRequest = function(details) {
  // don't actually need the timer functionality, but this pops it
  // out into chromeWindow's thread so that we get that security
  // context.
  GM_log("> GM_xmlhttpRequest.contentStartRequest");

  // important to store this locally so that content cannot trick us up with
  // a fancy getter that checks the number of times it has been accessed,
  // returning a dangerous URL the time that we actually use it.
  var url = details.url;

  // make sure that we have an actual string so that we can't be fooled with
  // tricky toString() implementations.
  if (typeof url != "string") {
    throw new Error("Invalid url: url must be of type string");
  }

  var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                  .getService(Components.interfaces.nsIIOService);
  this.currentUri_ = ioService.newURI(this.safeContentWin.location.href, null,
                                      null);
  this.remoteUri_ = ioService.newURI(url, null, this.currentUri_);

  // This is important - without it, GM_xmlhttpRequest can be used to get
  // access to things like files and chrome. Careful.
  if (this.remoteUri_.scheme != "http" && this.remoteUri_.scheme != "https" &&
      this.remoteUri_.scheme != "ftp") {
    throw new Error("Invalid url: " + this.remoteUri_.spec);
  }

  this.chromeWindow.setTimeout(
    GM_hitch(this, "chromeStartRequest", url, details), 0);

  GM_log("< GM_xmlhttpRequest.contentStartRequest");
};

// this function is intended to be called in chrome's security context, so
// that it can access other domains without security warning
GM_xmlhttpRequester.prototype.chromeStartRequest = function(safeUrl, details) {
  GM_log("> GM_xmlhttpRequest.chromeStartRequest");
  this.req_ = new this.chromeWindow.XMLHttpRequest();

  this.setupRequestEvent(this.unsafeContentWin, this.req_, "onload", details);
  this.setupRequestEvent(this.unsafeContentWin, this.req_, "onerror", details);
  this.setupRequestEvent(this.unsafeContentWin, this.req_, "onreadystatechange",
                         details);

  this.req_.open(details.method, safeUrl);

  if (details.overrideMimeType) {
    this.req_.overrideMimeType(details.overrideMimeType);
  }

  if (details.headers) {
    for (var prop in details.headers) {
      this.req_.setRequestHeader(prop, details.headers[prop]);
    }
  }

  this.initCookieDestroyer();

  this.req_.send((details.data) ? details.data : null);
  GM_log("< GM_xmlhttpRequest.chromeStartRequest");
}

GM_xmlhttpRequester.prototype.initCookieDestroyer = function() {
  // Always allow cookies for same-origin.
  if (this.currentUri_.prePath == this.remoteUri_.prePath) {
    return;
  }

  // Always allow cookies for FF3
  var appInfo = Cc["@mozilla.org/xre/app-info;1"].getService(Ci.nsIXULAppInfo);
  var versionChecker = Cc["@mozilla.org/xpcom/version-comparator;1"]
                         .getService(Ci.nsIVersionComparator);
  if(versionChecker.compare(appInfo.version, "3.0") >= 0) {
    return;
  }

  // This is a cross-origin request on FF < 3. Strip the cookies.
  this.obsSvc_ = Cc["@mozilla.org/observer-service;1"]
                   .getService(Ci.nsIObserverService);
  this.obsSvc_.addObserver(this, "http-on-modify-request",
                           false); // strong reference, weak references not
                                   // supported for JS :(
}

// arranges for the specified 'event' on xmlhttprequest 'req' to call the
// method by the same name which is a property of 'details' in the content
// window's security context.
GM_xmlhttpRequester.prototype.setupRequestEvent =
function(unsafeContentWin, req, event, details) {
  GM_log("> GM_xmlhttpRequester.setupRequestEvent");

  if (details[event]) {
    req[event] = function() {
      GM_log("> GM_xmlhttpRequester -- callback for " + event);

      var responseState = {
        // can't support responseXML because security won't
        // let the browser call properties on it
        responseText:req.responseText,
        readyState:req.readyState,
        responseHeaders:(req.readyState == 4 ?
                         req.getAllResponseHeaders() :
                         ''),
        status:(req.readyState == 4 ? req.status : 0),
        statusText:(req.readyState == 4 ? req.statusText : ''),
        finalUrl:(req.readyState == 4 ? req.channel.URI.spec : '')
      }

      // Pop back onto browser thread and call event handler.
      // Have to use nested function here instead of GM_hitch because
      // otherwise details[event].apply can point to window.setTimeout, which
      // can be abused to get increased priveledges.
      new XPCNativeWrapper(unsafeContentWin, "setTimeout()")
        .setTimeout(function(){details[event](responseState);}, 0);

      GM_log("< GM_xmlhttpRequester -- callback for " + event);
    }
  }

  GM_log("< GM_xmlhttpRequester.setupRequestEvent");
};

GM_xmlhttpRequester.prototype.observe = function(subject, topic, data) {
  if (topic != "http-on-modify-request" || subject != this.req_.channel) {
    return;
  }

  this.req_.channel.QueryInterface(Ci.nsIHttpChannel);
  // The false final parameter makes the empty string overwrite the existing
  // cookies.
  this.req_.channel.setRequestHeader("Cookie", "", false);

  // We're done, remove observer so that we don't leak.
  this.obsSvc_.removeObserver(this, "http-on-modify-request");
}
