const CLASSNAME = "GM_GreasemonkeyService";
const CONTRACTID = "@greasemonkey.mozdev.org/greasemonkey-service;1";
const CID = Components.ID("{77bf3650-1cd6-11da-8cd6-0800200c9a66}");

const ifaces = Components.interfaces;

const appSvc = Components.classes["@mozilla.org/appshell/appShellService;1"]
                         .getService(ifaces.nsIAppShellService);

function alert(msg) {
  Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
            .getService(ifaces.nsIPromptService)
            .alert(null, "message from your mom", msg);
}


var greasemonkeyService = {

  browserWindows: [],


  // nsISupports
  QueryInterface: function(aIID) {
    if (!aIID.equals(ifaces.nsIObserver) &&
        !aIID.equals(ifaces.nsISupports) &&
        !aIID.equals(ifaces.nsIWebProgressListener) &&
        !aIID.equals(ifaces.nsISupportsWeakReference) &&
        !aIID.equals(ifaces.gmIGreasemonkeyService) &&
        !aIID.equals(ifaces.nsIWindowMediatorListener))
      throw Components.results.NS_ERROR_NO_INTERFACE;

    return this;
  },


  // nsIObserver
  observe: function(aSubject, aTopic, aData) {
    if (aTopic == "http-startup") {
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
    Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
              .getService(Components.interfaces.mozIJSSubScriptLoader)
              .loadSubScript("chrome://global/content/XPCNativeWrapper.js");

    Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
              .getService(Components.interfaces.mozIJSSubScriptLoader)
              .loadSubScript("chrome://greasemonkey/content/prefmanager.js");

    Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
              .getService(Components.interfaces.mozIJSSubScriptLoader)
              .loadSubScript("chrome://greasemonkey/content/utils.js");

    Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
              .getService(Components.interfaces.mozIJSSubScriptLoader)
              .loadSubScript("chrome://greasemonkey/content/config.js");

    Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
              .getService(Components.interfaces.mozIJSSubScriptLoader)
              .loadSubScript("chrome://greasemonkey/content/convert2RegExp.js");

    Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
              .getService(Components.interfaces.mozIJSSubScriptLoader)
              .loadSubScript("chrome://greasemonkey/content/miscapis.js");

    Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
              .getService(Components.interfaces.mozIJSSubScriptLoader)
              .loadSubScript("chrome://greasemonkey/content/xmlhttprequester.js");

    loggify(this, "GM_GreasemonkeyService");
  },


  initScripts: function(url) {
    var config = new Config(getScriptFile("config.xml"));
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

    for (var i = 0; script = scripts[i]; i++) {
      sandbox = this.getSandbox(url);

      logger = new GM_ScriptLogger(script);
      storage = new GM_ScriptStorage(script);
      xmlhttpRequester = new GM_xmlhttpRequester(unsafeContentWin, appSvc.hiddenDOMWindow);

      //TODO(aa): pending https://bugzilla.mozilla.org/show_bug.cgi?id=307005
      //sandbox.__proto__ = new XPCNativeWrapper(unsafeContentWin);

      if (GM_deepWrappersEnabled(unsafeContentWin)) {
        sandbox.window = new XPCNativeWrapper(unsafeContentWin);
        sandbox.document = sandbox.window.document;
      } else {
        sandbox.window = unsafeContentWin;
        sandbox.document = new XPCNativeWrapper(unsafeContentWin, 
                                                "document").document;
      }

      sandbox.unsafeWindow = unsafeContentWin;

      sandbox.GM_addStyle = function(css) { GM_addStyle(sandbox.document, css) };
      sandbox.GM_log = GM_hitch(logger, "log");
      sandbox.GM_setValue = GM_hitch(storage, "setValue");
      sandbox.GM_getValue = GM_hitch(storage, "getValue");
      sandbox.GM_openInTab = GM_hitch(this, "openInTab", unsafeContentWin);
      sandbox.GM_xmlhttpRequest = GM_hitch(xmlhttpRequester, 
                                           "contentStartRequest");
      sandbox.GM_registerMenuCommand = GM_hitch(this, 
                                                "registerMenuCommand", 
                                                unsafeContentWin);

      sandbox.__proto__ = unsafeContentWin;

      try {
        this.evalInSandbox("(function(){\n" +
                           getContents(getScriptFileURI(script.filename).spec) +
                           "\n})()",
                           url, 
                           sandbox);
      } catch (e) {
        var e2 = new Error(e.message);
        e2.fileName = script.filename;
        e2.lineNumber = e.lineNumber - e2.lineNumber;
        GM_logError(e2);
      }
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

  getSandbox: function(codebase) {
    // DP beta+
    if (Components.utils && Components.utils.Sandbox) {
      return new Components.utils.Sandbox(codebase);
    // DP alphas
    } else if (Components.utils && Components.utils.evalInSandbox) {
      return Components.utils.evalInSandbox("", codebase);
    // 1.0.x
    } else if (Sandbox) {
      return new Sandbox();
    } else {
      throw new Error("Could not create sandbox.");
    }
  },

  evalInSandbox: function(code, codebase, sandbox) {
    // DP beta+
    if (Components.utils && Components.utils.Sandbox) {
      Components.utils.evalInSandbox(code, sandbox);
    // DP alphas
    } else if (Components.utils && Components.utils.evalInSandbox) {
      Components.utils.evalInSandbox(code, codebase, sandbox);
    // 1.0.x
    } else if (Sandbox) {
      evalInSandbox(code, sandbox, codebase);
    } else {
      throw new Error("Could not create sandbox.");
    }
  },
};

//loggify(greasemonkeyService, "greasemonkeyService");



/** 
 * XPCOM Registration goop
 */
var Module = new Object();

Module.registerSelf = function(compMgr, fileSpec, location, type) {
  compMgr = compMgr.QueryInterface(Components.interfaces.nsIComponentRegistrar);
  compMgr.registerFactoryLocation(CID,
                                  CLASSNAME,
                                  CONTRACTID,
                                  fileSpec,
                                  location,
                                  type);

  var catMgr = Components.classes["@mozilla.org/categorymanager;1"]
                         .getService(ifaces.nsICategoryManager);

  catMgr.addCategoryEntry("http-startup-category",
                          CLASSNAME,
                          CONTRACTID,
                          true,
                          true);
}

Module.getClassObject = function(compMgr, cid, iid) {
  if (!cid.equals(CID)) {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  }
  
  if (!iid.equals(Components.interfaces.nsIFactory)) {
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