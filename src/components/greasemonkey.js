const CLASSNAME = "GM_GreasemonkeyService";
const CONTRACTID = "@greasemonkey.mozdev.org/greasemonkey-service;1";
const CID = Components.ID("{77bf3650-1cd6-11da-8cd6-0800200c9a66}");

const Cc = Components.classes;
const Ci = Components.interfaces;

const appSvc = Cc["@mozilla.org/appshell/appShellService;1"]
                 .getService(Ci.nsIAppShellService);

function alert(msg) {
  Cc["@mozilla.org/embedcomp/prompt-service;1"]
    .getService(Ci.nsIPromptService)
    .alert(null, "message from your mom", msg);
}

var greasemonkeyService = {

  browserWindows: [],


  // nsISupports
  QueryInterface: function(aIID) {
    if (!aIID.equals(Ci.nsIObserver) &&
        !aIID.equals(Ci.nsISupports) &&
        !aIID.equals(Ci.nsISupportsWeakReference) &&
        !aIID.equals(Ci.gmIGreasemonkeyService) &&
        !aIID.equals(Ci.nsIWindowMediatorListener) &&
	!aIID.equals(Ci.nsIContentPolicy)) {
      throw Components.results.NS_ERROR_NO_INTERFACE;
    }

    return this;
  },


  // nsIObserver
  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "app-startup") {
      this.startup();
    }
  },


  // gmIGreasemonkeyService
  registerBrowser: function(browserWin) {
    var existing;

    for (var i = 0; existing = this.browserWindows[i]; i++) {
      if (existing == browserWin) {
        throw new Error("Browser window has already been registered.");
      }
    }

    this.browserWindows.push(browserWin);
  },

  unregisterBrowser: function(browserWin) {
   var existing;

    for (var i = 0; existing = this.browserWindows[i]; i++) {
      if (existing == browserWin) {
        this.browserWindows.splice(i, 1);
        return;
      }
    }

    throw new Error("Browser window is not registered.");
  },

  domContentLoaded: function(wrappedWindow) {
    var unsafeWin = wrappedWindow.wrappedJSObject;
    var unsafeLoc = new XPCNativeWrapper(unsafeWin, "location").location;
    var href = new XPCNativeWrapper(unsafeLoc, "href").href;
    var scripts = this.initScripts(href);

    if (scripts.length > 0) {
      this.injectScripts(scripts, href, unsafeWin);
    }
  },


  startup: function() {
    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader)
      .loadSubScript("chrome://global/content/XPCNativeWrapper.js");

    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader)
      .loadSubScript("chrome://greasemonkey/content/prefmanager.js");

    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader)
      .loadSubScript("chrome://greasemonkey/content/utils.js");

    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader)
      .loadSubScript("chrome://greasemonkey/content/config.js");

    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader)
      .loadSubScript("chrome://greasemonkey/content/convert2RegExp.js");

    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader)
      .loadSubScript("chrome://greasemonkey/content/miscapis.js");

    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader)
      .loadSubScript("chrome://greasemonkey/content/xmlhttprequester.js");
      
      
    Cc["@mozilla.org/moz/jssubscript-loader;1"]
      .getService(Ci.mozIJSSubScriptLoader)
      .loadSubScript("chrome://greasemonkey/content/downloadqueue.js");

    //loggify(this, "GM_GreasemonkeyService");
  },

  shouldLoad: function(ct, cl, org, ctx, mt, ext) {
    var ret = Ci.nsIContentPolicy.ACCEPT;

    // block content detection of greasemonkey by denying GM
    // chrome content, unless loaded from chrome
    if (org && org.scheme != "chrome" && cl.scheme == "chrome" &&
        decodeURI(cl.host) == "greasemonkey") {
      return Ci.nsIContentPolicy.REJECT_SERVER;
    }

    // don't interrupt the view-source: scheme
    // (triggered if the link in the error console is clicked)
    if ("view-source" == cl.scheme) {
      return Ci.nsIContentPolicy.ACCEPT;
    }

    if (ct == Ci.nsIContentPolicy.TYPE_DOCUMENT && 
	cl.spec.match(/\.user\.js$/)) {

      dump("shouldload: " + cl.spec + "\n");
      dump("ignorescript: " + this.ignoreNextScript_ + "\n");

      if (!this.ignoreNextScript_) {
	if (!this.isTempScript(cl)) {
	  var winWat = Cc["@mozilla.org/embedcomp/window-watcher;1"]
	    .getService(Ci.nsIWindowWatcher);

	  if (winWat.activeWindow && winWat.activeWindow.GM_BrowserUI) {
	    winWat.activeWindow.GM_BrowserUI.startInstallScript(cl);
	    ret = Ci.nsIContentPolicy.REJECT_REQUEST;
	  }
	}
      }
    }

    this.ignoreNextScript_ = false;
    return ret;
  },
  
  shouldProcess: function(ct, cl, org, ctx, mt, ext) {
    return Ci.nsIContentPolicy.ACCEPT;
  },

  ignoreNextScript: function() {
    dump("ignoring next script...\n");
    this.ignoreNextScript_ = true;
  },

  isTempScript: function(uri) {
    if (uri.scheme != "file") {
      return false;
    }

    var fph = Components.classes["@mozilla.org/network/protocol;1?name=file"]
    .getService(Ci.nsIFileProtocolHandler);

    var file = fph.getFileFromURLSpec(uri.spec);
    var tmpDir = Components.classes["@mozilla.org/file/directory_service;1"]
    .getService(Components.interfaces.nsIProperties)
    .get("TmpD", Components.interfaces.nsILocalFile);

    return file.parent.equals(tmpDir) && file.leafName != "newscript.user.js";
  },

  initScripts: function(url) {
    var config = new Config();
    var scripts = [];
    config.load();
    
    outer:
    for (var i = 0; i < config.scripts.length; i++) {
      var script = config.scripts[i];
      if (script.enabled) {
        for (var j = 0; j < script.includes.length; j++) {
          var pattern = convert2RegExp(script.includes[j]);

          if (pattern.test(url)) {
            for (var k = 0; k < script.excludes.length; k++) {
              pattern = convert2RegExp(script.excludes[k]);
    
              if (pattern.test(url)) {
                continue outer;
              }
            }

            scripts.push(script);

            continue outer;
          }
        }
      }
    }

    log("* number of matching scripts: " + scripts.length);
    return scripts;
  },

  injectScripts: function(scripts, url, unsafeContentWin) {
    var sandbox;
    var script;
    var logger;
    var storage;
    var xmlhttpRequester;
    var safeWin = new XPCNativeWrapper(unsafeContentWin);
    var safeDoc = safeWin.document;

    for (var i = 0; script = scripts[i]; i++) {
      sandbox = new Components.utils.Sandbox(safeWin);

      logger = new GM_ScriptLogger(script);
      storage = new GM_ScriptStorage(script);
      xmlhttpRequester = new GM_xmlhttpRequester(unsafeContentWin, 
                                                 appSvc.hiddenDOMWindow);
      imports = new GM_Imports(script);
      sandbox.window = safeWin;
      sandbox.document = sandbox.window.document;
      sandbox.unsafeWindow = unsafeContentWin;

      // hack XPathResult since that is so commonly used
      sandbox.XPathResult = Ci.nsIDOMXPathResult;

      // add our own APIs
      sandbox.GM_addStyle = function(css) { GM_addStyle(safeDoc, css) };
      sandbox.GM_log = GM_hitch(logger, "log");
      sandbox.GM_setValue = GM_hitch(storage, "setValue");
      sandbox.GM_getValue = GM_hitch(storage, "getValue");
      sandbox.GM_getImport = GM_hitch(imports, "getImport"); 
      sandbox.GM_openInTab = GM_hitch(this, "openInTab", unsafeContentWin);
      sandbox.GM_xmlhttpRequest = GM_hitch(xmlhttpRequester, 
                                           "contentStartRequest");
      sandbox.GM_registerMenuCommand = GM_hitch(this, 
                                                "registerMenuCommand", 
                                                unsafeContentWin);

      sandbox.__proto__ = safeWin;

      var contents = getContents(getScriptFileURI(script))
      
      GM_log("Sub-scripts: " + script.requires.length);
      var requires = [];
      var offsets = [];
      var offset = 0;
      script.requires.forEach(function(req){
          var uri = getDependencyFileURI(script, req);
          var contents = getContents(uri);
          var lineCount = contents.split("\n").length 
          requires.push(getContents(uri));
          offset += lineCount;
          offsets.push(offset);
      })
      script.offsets = offsets; 
      
      var scriptSrc = "(function(){\n" +
                         requires.join("\n") +
                         "\n" + 
                         contents +
                         "\n})()";
      this.evalInSandbox(scriptSrc,
                         url,
                         sandbox,
                         script);
    }
  },

  registerMenuCommand: function(unsafeContentWin, commandName, commandFunc, 
                                accelKey, accelModifiers, accessKey) {
    var command = {name: commandName,
                   accelKey: accelKey,
                   accelModifiers: accelModifiers,
                   accessKey: accessKey,
                   doCommand: commandFunc,
                   window: unsafeContentWin };

    for (var i = 0; i < this.browserWindows.length; i++) {
      this.browserWindows[i].registerMenuCommand(command);
    }
  },

  openInTab: function(unsafeContentWin, url) {
    var unsafeTop = new XPCNativeWrapper(unsafeContentWin, "top").top;

    for (var i = 0; i < this.browserWindows.length; i++) {
      this.browserWindows[i].openInTab(unsafeTop, url);
    }
  },

  evalInSandbox: function(code, codebase, sandbox, script) {
    if (!(Components.utils && Components.utils.Sandbox)) {
      var e = new Error("Could not create sandbox.");
      GM_logError(e, 0, e.fileName, e.lineNumber);
    } else {
      try {
        // workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=307984
        var lineFinder = new Error();
        Components.utils.evalInSandbox(code, sandbox);
      } catch (e) {
        var err = this.findError(script, e.lineNumber-lineFinder.lineNumber-1);
        GM_logError(
          e, // error obj
          0, // 0 = error (1 = warning)
          err.uri, 
          err.lineNumber
        );
      }
    }
  },
  
  findError : function(script, lineNumber){
      var start = 0;
      var end = 1;
      for(var i=0; i<script.offsets.length; i++){
          end = script.offsets[i];
          if(lineNumber < end){
              return { uri: getDependencyFileURI(script, script.requires[i]).spec,
                       lineNumber: (lineNumber - start)};
          }
          start = end;
      }
      return { uri: getScriptFileURI(script).spec,
                    lineNumber: (lineNumber - end)};
  }
};

greasemonkeyService.wrappedJSObject = greasemonkeyService;

//loggify(greasemonkeyService, "greasemonkeyService");



/** 
 * XPCOM Registration goop
 */
var Module = new Object();

Module.registerSelf = function(compMgr, fileSpec, location, type) {
  compMgr = compMgr.QueryInterface(Ci.nsIComponentRegistrar);
  compMgr.registerFactoryLocation(CID,
                                  CLASSNAME,
                                  CONTRACTID,
                                  fileSpec,
                                  location,
                                  type);

  var catMgr = Cc["@mozilla.org/categorymanager;1"]
                 .getService(Ci.nsICategoryManager);

  catMgr.addCategoryEntry("app-startup",
                          CLASSNAME,
                          CONTRACTID,
                          true,
                          true);

  catMgr.addCategoryEntry("content-policy", 
			  CONTRACTID,
                          CONTRACTID,
                          true,
                          true);
}

Module.getClassObject = function(compMgr, cid, iid) {
  if (!cid.equals(CID)) {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  }
  
  if (!iid.equals(Ci.nsIFactory)) {
    throw Components.results.NS_ERROR_NO_INTERFACE;
  }

  return Factory;
}

Module.canUnload = function(compMgr) {
  return true;
}


var Factory = new Object();

Factory.createInstance = function(outer, iid) {
  if (outer != null) {
    throw Components.results.NS_ERROR_NO_AGGREGATION;
  }

  return greasemonkeyService;
}


function NSGetModule(compMgr, fileSpec) {
  return Module;
}

//loggify(Module, "greasemonkeyService:Module");
//loggify(Factory, "greasemonkeyService:Factory");
