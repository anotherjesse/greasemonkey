function ScriptDownloader(win, uri, bundle) {
  this.win_ = win;
  this.uri_ = uri;
  this.bundle_ = bundle;
  this.req_ = null;
  this.script = null;
  this.depQueue_ = [];
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

  // If loading from file, status might be zero on success
  if (this.req_.status != 200 && this.req_.status != 0) {
    this.win_.GM_BrowserUI.refreshStatus();
    this.win_.GM_BrowserUI.hideStatus();
    
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
  this.win_.GM_BrowserUI.showStatus("Fetching dependencies", false);
  
  
  downloader = new DownloadQueue();

  var deps = this.script.requires.concat(this.script.imports);
   for(var i=0; i<deps.length; i++){
     var dep = deps[i];
     if(this.checkDependencyURL(dep.url)){
         this.depQueue_.push(dep);
     }else{
         this.errorInstallDependency(this.script, dep, "SecurityException: Request to local and chrome url's is forbidden")
         return;
     }
   }
   this.downloadNextDependency();
}

ScriptDownloader.prototype.downloadNextDependency = function(){
  if (this.depQueue_.length>0) {
    var dep = this.depQueue_.pop();
    try{
      var persist = Components.classes["@mozilla.org/embedding/browser/nsWebBrowserPersist;1"].createInstance(Components.interfaces.nsIWebBrowserPersist);
      persist.persistFlags = persist.PERSIST_FLAGS_BYPASS_CACHE | persist.PERSIST_FLAGS_REPLACE_EXISTING_FILES; //doesn't work? 
      var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
                  .getService();
      var sourceUri = ioservice.newURI(dep.url, null, null);
      var sourceChannel = ioservice.newChannelFromURI(sourceUri);
      sourceChannel.notificationCallbacks = new NotificationCallbacks();
    
      var file = getTempFile();
    
      var progressListener = new PersistProgressListener(persist);
      progressListener.onFinish =  GM_hitch(this, "handleDependencyDownloadComplete", dep, file, sourceChannel);
      persist.progressListener = progressListener;
     
      persist.saveChannel(sourceChannel,  file);
    }catch(e){
      GM_log("Download exception " + e);
      this.errorInstallDependency(this.script, dep, e);
    }
  } else {
      this.finishInstall();
  } 
}

ScriptDownloader.prototype.handleDependencyDownloadComplete = function(dep, file, channel){
  GM_log("DQ: Download complete ");
  try{
    var httpChannel = channel.QueryInterface(Components.interfaces.nsIHttpChannel);
  }catch(e){
    var httpChannel = false;    
  }
  
  if(httpChannel){
    if(httpChannel.requestSucceeded){
      dep.file = file;
      dep.mimetype= channel.contentType;  
      this.downloadNextDependency();
    }else{
      this.errorInstallDependency(this.script, dep, "Error! Server Returned : " + httpChannel.responseStatus + ": " + httpChannel.responseStatusText);
    }
  }else{
    job.onload(file, channel.contentType);
    downloadNext();
  }
}

ScriptDownloader.prototype.checkDependencyURL = function(url){
  var ioService = Components.classes["@mozilla.org/network/io-service;1"]
                  .getService(Components.interfaces.nsIIOService);
  var scheme = ioService.extractScheme(url);

  switch (scheme) {
    case "http":
    case "https":
    case "ftp":
        return true;
    case "file":
        scriptScheme = ioService.extractScheme(this.uri_.spec);
        return (scriptScheme == "file")
    default:
      return false;
  }
}

ScriptDownloader.prototype.finishInstall = function(){
  this.win_.GM_BrowserUI.hideStatus();
  this.win_.GM_BrowserUI.refreshStatus();
  if (this.installing_) {
    this.showInstallDialog();
  } else {
    this.showScriptView();
  }    
}

ScriptDownloader.prototype.errorInstall = function(){
  GM_log("Error installing script");
}

ScriptDownloader.prototype.errorInstallDependency = function(script, dep, msg){
  this.win_.GM_BrowserUI.refreshStatus();
  alert("Error loading dependency " + req.url + "\n" + msg);
}

ScriptDownloader.prototype.showInstallDialog = function(timer) {
  if (!timer) {
    // otherwise, the status bar stays in the loading state.
    this.win_.setTimeout(GM_hitch(this, "showInstallDialog", true), 0);
    return;
  }
  this.win_.GM_BrowserUI.refreshStatus();
  this.win_.openDialog("chrome://greasemonkey/content/install.xul", "", 
		               "chrome,centerscreen,modal,dialog,titlebar,resizable",
		               this);
};

ScriptDownloader.prototype.showScriptView = function() {
  this.win_.GM_BrowserUI.showScriptView(this);
};

ScriptDownloader.prototype.openDependency = function(file){
  this.win_.GM_BrowserUI.openDependency(file)
}

ScriptDownloader.prototype.parseScript = function(source, uri) {
  var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
                            .getService();
	  
  var script = new Script();
  script.uri = uri;
  script.enabled = true;
  script.includes = [];
  script.excludes = [];
    
  // read one line at a time looking for start meta delimiter or EOF
  var lines = source.match(/.+/g);
  var lnIdx = 0;
  var result = {};
  var foundMeta = false;

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
          GM_log("Processing " + match[1]);
    	switch (match[1]) {
    	case "name":
    	case "namespace":
    	case "description":
    	  script[match[1]] = match[2];
    	  break;
    	case "include":
    	case "exclude":
    	  script[match[1]+"s"].push(match[2]);
    	  break;
        case "require":
          var reqUri = ioservice.newURI(match[2], null, uri);
          var scriptDependency = new ScriptDependency();
          scriptDependency.url = reqUri.spec;
          script.requires.push(scriptDependency);
          break;
        case "import":
          var imp = match[2].match(/([^\s]+)\s+([^\s]+)/);
          var impUri = ioservice.newURI(imp[2], null, uri);
          var scriptImport = new ScriptImport();
          scriptImport.name = imp[1];
          scriptImport.url = impUri.spec;
          script.imports.push(scriptImport);
          break;
    	}
      }
    }
  }

  // if no meta info, default to reasonable values
  if (script.name == null) {
    script.name = parseScriptName(uri);
  }

  if (script.namespace == null) {
    script.namespace = uri.host;
  }

  if (script.includes.length == 0) {
    script.includes.push("*");
  }

  this.script = script;
};


function NotificationCallbacks(){
    
}

NotificationCallbacks.prototype = {
   QueryInterface : function(aIID)
   {
       if(aIID.equals(Components.interfaces.nsIInterfaceRequestor)){
           return this;
       }
       throw Components.results.NS_NOINTERFACE;
   },
   
   getInterface : function(aIID){
       if(aIID.equals(Components.interfaces.nsIAuthPrompt )){
         var winWat = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                          .getService(Components.interfaces.nsIWindowWatcher);
         return winWat.getNewAuthPrompter(winWat.activeWindow);                          
       }
   } 
};

function PersistProgressListener(persist){
	this.persist = persist;
    this.onFinish = function(){};
	this.persiststate = "";
};

PersistProgressListener.prototype =
 {
   QueryInterface : function(aIID)
   {
     if(aIID.equals(Components.interfaces.nsIWebProgressListener)){
       return this;
     }
     throw Components.results.NS_NOINTERFACE;
   },
   
 
   // nsIWebProgressListener
   onProgressChange : function (aWebProgress, aRequest,
                                aCurSelfProgress, aMaxSelfProgress,
                                aCurTotalProgress, aMaxTotalProgress)
   {
      GM_log("Persister.progress: "+ aCurTotalProgress + " of "+ aMaxTotalProgress);
   },
 
   onStateChange : function(aWebProgress, aRequest, aStateFlags, aStatus)
   {
     try {
       if(this.persist.currentState == this.persist.PERSIST_STATE_READY){
            
       }else if(this.persist.currentState == this.persist.PERSIST_STATE_SAVING){
           
       }else if(this.persist.currentState == this.persist.PERSIST_STATE_FINISHED){
          GM_log("Persister: Download complete " + aRequest.status);
	      this.onFinish();
       }
     }catch(e) {
       //  log("Exception " + e + " : " + e.fileName + " " + e.lineNumber);
     }
     
   },
 
   onLocationChange : function(aWebProgress, aRequest, aLocation)
   {
   },
 
   onStatusChange : function(aWebProgress, aRequest, aStatus, aMessage)
   {
     GM_log("Persister.onStatusChange: " + aMessage);
   },
 
   onSecurityChange : function(aWebProgress, aRequest, aState)
   {
   }
}